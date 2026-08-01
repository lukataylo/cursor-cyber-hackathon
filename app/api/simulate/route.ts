import { NextRequest, NextResponse } from "next/server";
import { ingestInbound, recordOutbound } from "@/lib/pipeline";
import { personaReply } from "@/lib/agents";

export const maxDuration = 60;

// Demo/test harness: inject a scammer message straight into the pipeline (no Gmail needed).
// Generates and stores the agent's reply so the whole flow lights up on the dashboard.
export async function POST(req: NextRequest) {
  const { body, from = "scammer@example.com", subject = "URGENT: Your account" } = await req.json();
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const { threadId, subject: subj, injection, history } = await ingestInbound({
    channel: "email",
    externalThreadKey: from,
    counterparty: from,
    subject,
    body,
  });

  const reply = await personaReply(subj, history as { direction: "inbound" | "outbound"; body: string }[]);
  await recordOutbound(threadId, reply);

  return NextResponse.json({ threadId, injection, reply });
}
