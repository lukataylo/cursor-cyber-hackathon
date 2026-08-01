import { NextRequest, NextResponse } from "next/server";
import { ingestInbound } from "@/lib/pipeline";

export const maxDuration = 60;

// Vapi webhook. The voice persona runs live inside Vapi; we ingest the transcript
// at end-of-call and extract IOCs into the same pipeline as email.
export async function POST(req: NextRequest) {
  if (
    process.env.VAPI_WEBHOOK_SECRET &&
    req.headers.get("x-vapi-secret") !== process.env.VAPI_WEBHOOK_SECRET
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await req.json();
  const msg = payload?.message ?? {};
  if (msg.type !== "end-of-call-report") {
    return NextResponse.json({ ok: true, ignored: msg.type });
  }

  const transcript: string =
    msg.artifact?.transcript ?? msg.transcript ?? "(no transcript)";
  const callId: string = msg.call?.id ?? "unknown";
  const from: string = msg.call?.customer?.number ?? `caller:${callId}`;
  const durationSec: number = Number(msg.durationSeconds ?? msg.call?.duration ?? 0);

  await ingestInbound({
    channel: "voice",
    externalThreadKey: callId,
    counterparty: from,
    subject: `Voice call ${callId.slice(0, 8)}`,
    body: transcript,
    minutesToAdd: durationSec / 60,
  });

  return NextResponse.json({ ok: true });
}
