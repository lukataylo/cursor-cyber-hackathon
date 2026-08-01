import { NextRequest, NextResponse } from "next/server";
import { listNew, sendReply } from "@/lib/gmail";
import { ingestInbound, recordOutbound } from "@/lib/pipeline";
import { personaReply } from "@/lib/agents";

export const maxDuration = 60;

// Called by Vercel Cron every minute (and manually during the demo).
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const inbound = await listNew();
  const results = [];
  for (const email of inbound) {
    const { threadId, subject, injection, history } = await ingestInbound({
      channel: "email",
      externalThreadKey: email.threadId,
      counterparty: email.from,
      subject: email.subject,
      body: email.body,
    });

    const reply = await personaReply(subject, history as { direction: "inbound" | "outbound"; body: string }[]);
    await sendReply(email, reply);
    await recordOutbound(threadId, reply);
    results.push({ from: email.from, injection, replied: true });
  }

  return NextResponse.json({ processed: results.length, results });
}
