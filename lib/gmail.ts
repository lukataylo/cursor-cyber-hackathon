import { google, gmail_v1 } from "googleapis";

function client() {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth });
}

export type InboundEmail = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  messageIdHeader: string;
};

function header(msg: gmail_v1.Schema$Message, name: string) {
  return (
    msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

// Recursively find the first part matching a mime type (handles nested multipart/*).
function findPart(part: gmail_v1.Schema$MessagePart | undefined, mime: string): gmail_v1.Schema$MessagePart | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

function decodeBody(msg: gmail_v1.Schema$Message): string {
  const payload = msg.payload;
  // Prefer text/plain anywhere in the tree, then text/html (stripped), then the raw body.
  const plain = findPart(payload, "text/plain");
  const html = findPart(payload, "text/html");
  const raw = plain?.body?.data || (payload?.body?.data && !payload?.parts ? payload.body.data : undefined);
  let text = "";
  if (plain?.body?.data) text = Buffer.from(plain.body.data, "base64url").toString("utf-8");
  else if (raw) text = Buffer.from(raw, "base64url").toString("utf-8");
  else if (html?.body?.data) {
    const h = Buffer.from(html.body.data, "base64url").toString("utf-8");
    text = h.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  }
  // Strip quoted reply history so the agent classifies only the newest message.
  text = text.split(/\r?\n>|\r?\nOn .+wrote:|\r?\n-{2,} ?Original/)[0];
  text = text.replace(/&[a-z]+;/gi, " ").replace(/\s+\n/g, "\n").trim();
  return text || msg.snippet || "";
}

// Unread messages act as the work queue. Returns them and marks them read.
export async function listNew(): Promise<InboundEmail[]> {
  const g = client();
  // Safety gate: only process mail matching GMAIL_QUERY. Default requires a "honeypot"
  // label so the poller can never auto-reply to a real personal inbox.
  const q = process.env.GMAIL_QUERY || "label:honeypot is:unread";
  const list = await g.users.messages.list({ userId: "me", q, maxResults: 10 });
  const ids = list.data.messages ?? [];
  const out: InboundEmail[] = [];
  for (const { id } of ids) {
    if (!id) continue;
    const { data: msg } = await g.users.messages.get({ userId: "me", id, format: "full" });
    out.push({
      id,
      threadId: msg.threadId!,
      from: header(msg, "From"),
      subject: header(msg, "Subject"),
      body: decodeBody(msg),
      messageIdHeader: header(msg, "Message-ID"),
    });
    await g.users.messages.modify({ userId: "me", id, requestBody: { removeLabelIds: ["UNREAD"] } });
  }
  return out;
}

export async function sendReply(inbound: InboundEmail, body: string) {
  const g = client();
  const to = inbound.from;
  const subject = inbound.subject.startsWith("Re:") ? inbound.subject : `Re: ${inbound.subject}`;
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    inbound.messageIdHeader ? `In-Reply-To: ${inbound.messageIdHeader}` : "",
    inbound.messageIdHeader ? `References: ${inbound.messageIdHeader}` : "",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ]
    .filter(Boolean)
    .join("\r\n");
  await g.users.messages.send({
    userId: "me",
    requestBody: { threadId: inbound.threadId, raw: Buffer.from(raw).toString("base64url") },
  });
}
