import { supabaseAdmin } from "./supabase";
import { extractIOCs } from "./agents";
import { looksLikeInjection } from "./persona";

// Shared ingest path for both channels. Records the inbound message, flags injection,
// extracts + stores IOCs, and returns the thread id + full history for reply generation.
export async function ingestInbound(opts: {
  channel: "email" | "voice";
  externalThreadKey: string; // gmail threadId or vapi call id
  counterparty: string;
  subject: string;
  body: string;
  minutesToAdd?: number;
}) {
  const db = supabaseAdmin();

  // find-or-create thread keyed by (channel, subject-as-key). We store the external key in subject-less lookups via counterparty+channel.
  const { data: existing } = await db
    .from("threads")
    .select("*")
    .eq("channel", opts.channel)
    .eq("counterparty", opts.counterparty)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let thread = existing;
  if (!thread) {
    const { data, error } = await db
      .from("threads")
      .insert({ channel: opts.channel, counterparty: opts.counterparty, subject: opts.subject })
      .select("*")
      .single();
    if (error || !data)
      throw new Error(
        `threads insert failed: ${error?.message ?? "no row"} — did you run supabase/schema.sql?`
      );
    thread = data;
  }

  const injection = looksLikeInjection(opts.body);
  await db.from("messages").insert({
    thread_id: thread.id,
    direction: "inbound",
    body: opts.body,
    injection_flag: injection,
  });

  // IOC extraction (best-effort; never block the reply on it)
  try {
    const iocs = await extractIOCs(opts.body);
    if (iocs.length) {
      await db.from("iocs").upsert(
        iocs.map((i) => ({ ...i, thread_id: thread.id })),
        { onConflict: "thread_id,type,value", ignoreDuplicates: true }
      );
    }
  } catch (e) {
    console.error("[extractIOCs]", e);
  }

  const minutes = opts.minutesToAdd ?? 1.5;
  await db
    .from("threads")
    .update({
      last_at: new Date().toISOString(),
      minutes_wasted: Number(thread.minutes_wasted) + minutes,
      message_count: thread.message_count + 1,
    })
    .eq("id", thread.id);

  const { data: history } = await db
    .from("messages")
    .select("direction, body")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true });

  return { threadId: thread.id, subject: thread.subject ?? opts.subject, injection, history: history ?? [] };
}

export async function recordOutbound(threadId: string, body: string) {
  const db = supabaseAdmin();
  await db.from("messages").insert({ thread_id: threadId, direction: "outbound", body });
  await db.from("threads").update({ last_at: new Date().toISOString() }).eq("id", threadId);
}
