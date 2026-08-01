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

function decodeBody(msg: gmail_v1.Schema$Message): string {
  const parts = msg.payload?.parts ?? [];
  const textPart =
    parts.find((p) => p.mimeType === "text/plain") ?? (msg.payload?.body ? msg.payload : null);
  const data = (textPart as gmail_v1.Schema$MessagePart)?.body?.data ?? msg.payload?.body?.data;
  if (!data) return msg.snippet ?? "";
  return Buffer.from(data, "base64url").toString("utf-8");
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
