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

// CSV IOC feed export. ?threadId= scopes to one thread; omitted = full feed.
export async function GET(req: NextRequest) {
  const db = supabaseAdmin();
  const threadId = req.nextUrl.searchParams.get("threadId");
  let q = db.from("iocs").select("type,value,severity,confidence,created_at");
  if (threadId) q = q.eq("thread_id", threadId);
  const { data: iocs } = await q;
  const rows = ["type,value,severity,confidence,created_at"].concat(
    (iocs ?? []).map((i) => `${i.type},"${i.value}",${i.severity},${i.confidence},${i.created_at}`)
  );
  return new NextResponse(rows.join("\n"), {
    headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="iocs.csv"' },
  });
}

// Approve a drafted report (human-in-the-loop). PATCH { reportId }.
export async function PATCH(req: NextRequest) {
  const { reportId } = await req.json().catch(() => ({}));
  if (!reportId) return NextResponse.json({ error: "reportId required" }, { status: 400 });
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("reports")
    .update({ status: "approved" })
    .eq("id", reportId)
    .select("id, status")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || "not found" }, { status: 404 });
  return NextResponse.json({ report: data });
}
