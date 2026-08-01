// Pull real spam from the connected Gmail and run it through the honeypot agent.
// Usage: set -a; . ./.env.local; set +a; node scripts/pull-spam.mjs <base_url> [count]
import { google } from "googleapis";

const BASE = process.argv[2] || "http://localhost:3000";
const COUNT = Number(process.argv[3] || 6);

const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth: oauth });

const header = (m, n) => m.payload?.headers?.find((h) => h.name?.toLowerCase() === n)?.value ?? "";

function walk(part, mime) {
  if (!part) return "";
  if (part.mimeType === mime && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf-8");
  for (const p of part.parts ?? []) {
    const r = walk(p, mime);
    if (r) return r;
  }
  return "";
}
function bodyOf(m) {
  let text = walk(m.payload, "text/plain");
  if (!text) {
    const html = walk(m.payload, "text/html");
    text = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  }
  if (!text) text = m.snippet ?? "";
  return text.replace(/\s+/g, " ").replace(/&[a-z]+;/gi, " ").trim().slice(0, 1500);
}

const list = await gmail.users.messages.list({ userId: "me", q: "in:spam", maxResults: COUNT });
const ids = list.data.messages ?? [];
console.log(`found ${ids.length} spam messages, feeding ${BASE}/api/simulate\n`);

for (const { id } of ids) {
  const { data: m } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const from = header(m, "from");
  const subject = header(m, "subject") || "(no subject)";
  const body = bodyOf(m);
  if (body.length < 20) {
    console.log(`skip (empty): ${subject}`);
    continue;
  }
  const res = await fetch(`${BASE}/api/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, subject, body }),
  });
  const j = await res.json().catch(() => ({}));
  console.log(`✓ ${subject.slice(0, 60)}  ->  ${j.injection ? "[INJECTION] " : ""}${(j.reply || j.error || "").slice(0, 70)}`);
}
console.log("\nDone. Refresh the dashboard.");
