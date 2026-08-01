import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export const maxDuration = 60;

// Draft an abuse/takedown report from a thread's IOCs. DRAFT ONLY — human approves
// before anything is filed. This human-in-the-loop step is a deliberate safety control.
export async function POST(req: NextRequest) {
  const { threadId } = await req.json();
  const db = supabaseAdmin();

  const { data: iocs } = await db.from("iocs").select("*").eq("thread_id", threadId);
  const { data: thread } = await db.from("threads").select("*").eq("id", threadId).single();
  if (!iocs?.length) return NextResponse.json({ error: "no IOCs on thread" }, { status: 400 });

  const { text } = await generateText({
    model: anthropic("claude-sonnet-5"),
    system:
      "Draft a concise, factual abuse report to send to registrars/banks/CERTs about an active " +
      "phishing operation. State the IOCs, the observed behaviour, and requested action. Neutral, no speculation.",
    prompt: `Channel: ${thread?.channel}. Counterparty: ${thread?.counterparty}.\nIOCs:\n${iocs
      .map((i) => `- [${i.severity}] ${i.type}: ${i.value} (${i.evidence_snippet})`)
      .join("\n")}`,
  });

  const { data: report } = await db
    .from("reports")
    .insert({ thread_id: threadId, target: "abuse-desk", draft_body: text, status: "draft" })
    .select("*")
    .single();

  return NextResponse.json({ report });
}

// CSV IOC feed export.
export async function GET() {
  const db = supabaseAdmin();
  const { data: iocs } = await db.from("iocs").select("type,value,severity,confidence,created_at");
  const rows = ["type,value,severity,confidence,created_at"].concat(
    (iocs ?? []).map((i) => `${i.type},"${i.value}",${i.severity},${i.confidence},${i.created_at}`)
  );
  return new NextResponse(rows.join("\n"), {
    headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="iocs.csv"' },
  });
}
