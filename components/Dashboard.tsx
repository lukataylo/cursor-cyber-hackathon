"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import type { Thread, Message, Ioc } from "@/lib/types";
import { STAGES, type Stage, stageOf, topSeverity, isPaymentIoc, ago } from "@/lib/stage";

const SEV_COLOR: Record<Ioc["severity"], string> = {
  low: "var(--muted)",
  medium: "var(--warn)",
  high: "#fb923c",
  critical: "var(--danger)",
};
const CHANNEL = { email: "✉", voice: "📞" } as const;

type ReportRow = { thread_id: string; created_at: string; status: string };

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const db = useMemo(() => supabaseBrowser(), []);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [iocs, setIocs] = useState<Ioc[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [injections, setInjections] = useState<Message[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const load = useCallback(async () => {
    const [{ data: t }, { data: i }, { data: r }, { data: inj }] = await Promise.all([
      db.from("threads").select("*").order("last_at", { ascending: false }),
      db.from("iocs").select("*").order("created_at", { ascending: false }),
      db.from("reports").select("thread_id, created_at, status"),
      db
        .from("messages")
        .select("*")
        .eq("injection_flag", true)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    setThreads(t ?? []);
    setIocs(i ?? []);
    setReports((r ?? []) as ReportRow[]);
    setInjections(inj ?? []);
  }, [db]);

  const loadMessages = useCallback(
    async (id: string) => {
      const { data } = await db
        .from("messages")
        .select("*")
        .eq("thread_id", id)
        .order("created_at", { ascending: true });
      setMessages(data ?? []);
    },
    [db]
  );

  useEffect(() => {
    load();
    const ch = db
      .channel("live")
      .on("postgres_changes", { event: "*", schema: "public", table: "threads" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "iocs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        load();
        setSelected((cur) => {
          if (cur) loadMessages(cur);
          return cur;
        });
      })
      .subscribe();
    return () => {
      db.removeChannel(ch);
    };
  }, [db, load, loadMessages]);

  useEffect(() => {
    if (selected) loadMessages(selected);
  }, [selected, loadMessages]);

  const iocsByThread = useMemo(() => {
    const m = new Map<string, Ioc[]>();
    for (const i of iocs) (m.get(i.thread_id) ?? m.set(i.thread_id, []).get(i.thread_id)!).push(i);
    return m;
  }, [iocs]);
  const reportedSet = useMemo(() => new Set(reports.map((r) => r.thread_id)), [reports]);
  const threadById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);

  const withStage = useMemo(
    () =>
      threads.map((t) => ({
        t,
        stage: stageOf(t, iocsByThread.get(t.id) ?? [], reportedSet.has(t.id)),
      })),
    [threads, iocsByThread, reportedSet]
  );
  const byStage = (s: Stage) => withStage.filter((x) => x.stage === s);

  const totalMinutes = threads.reduce((a, t) => a + Number(t.minutes_wasted), 0);
  const escalatedCount = withStage.filter((x) => x.stage === "Escalated").length;
  const activeCount = withStage.filter((x) => x.stage !== "Reported").length;

  const activity = useMemo(() => {
    const ev = [
      ...iocs.map((i) => ({
        at: i.created_at,
        kind: "ioc" as const,
        thread_id: i.thread_id,
        label: `${i.type}: ${i.value}`,
        payment: isPaymentIoc(i),
      })),
      ...injections.map((m) => ({
        at: m.created_at,
        kind: "injection" as const,
        thread_id: m.thread_id,
        label: "Injection attempt blocked",
        payment: false,
      })),
    ];
    return ev.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 16);
  }, [iocs, injections]);

  const current = selected ? threadById.get(selected) : undefined;
  const currentIocs = selected ? iocsByThread.get(selected) ?? [] : [];
  const currentEscalated = currentIocs.some(isPaymentIoc);
  const ai = useMemo(() => aiAssessment(currentIocs), [currentIocs]);

  async function draftReport() {
    if (!selected) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: selected }),
      });
      const j = await res.json();
      if (!res.ok) alert(j.error ?? "Could not draft report");
      else {
        await load();
        alert("Draft report created — status: draft, awaiting human approval.");
      }
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="h-screen p-3 sm:p-4 flex" style={{ position: "relative", zIndex: 1 }}>
      <div className="app-window flex-1 flex flex-col overflow-hidden">
        {/* Title bar */}
        <header
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full live-dot" style={{ background: "var(--accent)" }} />
              <h1 className="text-sm font-semibold tracking-tight">
                Honeypot <span style={{ color: "var(--faint)" }}>· SOC console</span>
              </h1>
            </div>
          </div>
          <div className="flex gap-5">
            <Kpi label="Active" value={activeCount} />
            <Kpi label="Minutes wasted" value={totalMinutes.toFixed(1)} accent="var(--accent)" />
            <Kpi label="Escalated" value={escalatedCount} accent="var(--danger)" />
            <Kpi label="IOCs" value={iocs.length} />
            <Kpi label="Reports" value={reports.length} />
          </div>
        </header>

        <div className="flex flex-1 min-h-0">
          {/* Kanban */}
          <div className="flex-1 flex gap-3 p-4 overflow-x-auto">
            {STAGES.map((stage) => {
              const items = byStage(stage);
              const esc = stage === "Escalated";
              return (
                <div key={stage} className="flex flex-col min-w-[200px] flex-1">
                  <div className="flex items-center justify-between mb-2.5 px-1">
                    <span
                      className="text-xs uppercase tracking-wider font-medium"
                      style={{ color: esc ? "var(--danger)" : "var(--faint)" }}
                    >
                      {esc && "⚠ "}
                      {stage}
                    </span>
                    <span className="text-xs mono" style={{ color: "var(--faint)" }}>
                      {items.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 overflow-y-auto pr-1">
                    {items.map(({ t }) => {
                      const tIocs = iocsByThread.get(t.id) ?? [];
                      const sev = topSeverity(tIocs);
                      const pay = tIocs.find(isPaymentIoc);
                      const fresh = Date.now() - new Date(t.last_at).getTime() < 4000;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setSelected(t.id)}
                          className={`glass-card text-left flex gap-2.5 p-3 ${fresh ? "flash" : ""}`}
                          style={esc ? { borderColor: "color-mix(in srgb, var(--danger) 45%, transparent)" } : undefined}
                        >
                          <span
                            className="w-1 rounded-full shrink-0"
                            style={{ background: sev ? SEV_COLOR[sev] : "var(--border-hi)" }}
                          />
                          <span className="flex flex-col gap-1.5 min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-xs" style={{ color: "var(--muted)" }}>
                                {CHANNEL[t.channel]} {t.channel}
                              </span>
                              <span className="text-xs mono" style={{ color: "var(--accent)" }}>
                                {Number(t.minutes_wasted).toFixed(1)}m
                              </span>
                            </span>
                            <span className="text-sm truncate">{t.counterparty}</span>
                            <span className="flex items-center justify-between gap-2">
                              {pay ? (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold mono truncate"
                                  style={{ background: "var(--danger)", color: "var(--danger-ink)", maxWidth: "70%" }}
                                >
                                  {pay.type}: {pay.value}
                                </span>
                              ) : (
                                <span className="text-[10px] mono" style={{ color: "var(--faint)" }}>
                                  {tIocs.length} IOC{tIocs.length === 1 ? "" : "s"}
                                </span>
                              )}
                              <span className="text-[10px] mono" style={{ color: "var(--faint)" }}>
                                {ago(t.last_at)}
                              </span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    {!items.length && (
                      <div
                        className="text-xs rounded-xl border border-dashed p-3 text-center"
                        style={{ borderColor: "var(--border)", color: "var(--faint)" }}
                      >
                        —
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Activity feed */}
          <aside
            className="w-72 flex flex-col shrink-0"
            style={{ borderLeft: "1px solid var(--border)" }}
          >
            <div
              className="px-4 py-3 text-xs uppercase tracking-wider"
              style={{ borderBottom: "1px solid var(--border)", color: "var(--faint)" }}
            >
              Live activity
            </div>
            <div className="flex-1 overflow-y-auto">
              {activity.map((e, idx) => {
                const th = threadById.get(e.thread_id);
                return (
                  <button
                    key={idx}
                    onClick={() => setSelected(e.thread_id)}
                    className="w-full text-left px-4 py-2.5 flex gap-2.5 items-start hover:bg-[var(--glass-2)] transition-colors"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <span className="text-sm shrink-0">
                      {e.kind === "injection" ? "🛡" : e.payment ? "💰" : "🔎"}
                    </span>
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span
                        className="text-xs truncate"
                        style={{ color: e.kind === "injection" || e.payment ? "var(--danger)" : "var(--text)" }}
                      >
                        {e.label}
                      </span>
                      <span className="text-[10px] mono" style={{ color: "var(--faint)" }}>
                        {th?.counterparty ?? "—"} · {ago(e.at)}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!activity.length && (
                <p className="p-4 text-sm" style={{ color: "var(--faint)" }}>
                  Waiting for the first scammer…
                </p>
              )}
            </div>
            <a
              href="/api/report"
              className="m-3 text-xs px-3 py-2 rounded-lg text-center hover:bg-[var(--glass-2)] transition-colors"
              style={{ border: "1px solid var(--border)" }}
            >
              Export IOC feed (CSV)
            </a>
          </aside>
        </div>
      </div>

      {/* Email reader drawer */}
      {selected && (
        <div className="fixed inset-0 z-20 flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 backdrop-blur-scrim" />
          <div
            className="drawer drawer-panel relative h-full w-full max-w-[600px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Email header */}
            <div className="px-6 pt-5 pb-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight leading-snug" style={{ textWrap: "balance" }}>
                  {current?.subject}
                </h2>
                <button
                  onClick={() => setSelected(null)}
                  className="text-lg leading-none px-1 hover:opacity-70"
                  style={{ color: "var(--muted)" }}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <Avatar kind="scammer" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Scam sender</span>
                    {currentEscalated && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-semibold tracking-wide"
                        style={{ background: "var(--danger)", color: "var(--danger-ink)" }}
                      >
                        PAYMENT REVEALED
                      </span>
                    )}
                  </div>
                  <div className="text-xs mono truncate" style={{ color: "var(--muted)" }}>
                    {current?.counterparty}
                  </div>
                </div>
                <span className="text-xs" style={{ color: "var(--faint)" }}>
                  {CHANNEL[current?.channel ?? "email"]} {current?.channel}
                </span>
              </div>
              <div className="text-xs mt-1.5" style={{ color: "var(--faint)" }}>
                to: honeypot inbox
              </div>
            </div>

            {/* AI assessment banner */}
            <div className="px-6 pt-4 shrink-0">
              <div className="ai-banner rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="ai-spark text-sm" style={{ color: "var(--ai)" }}>✦</span>
                  <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--ai)" }}>
                    AI assessment
                  </span>
                  <span
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase"
                    style={{ color: "var(--ai)", border: "1px solid color-mix(in srgb, var(--ai) 40%, transparent)" }}
                  >
                    {ai.confidence} confidence
                  </span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
                  {ai.summary}
                </p>
              </div>
            </div>

            {/* Email thread */}
            <div className="flex-1 overflow-y-auto px-6 pt-2">
              {messages.map((m, idx) => {
                const out = m.direction === "outbound";
                return (
                  <article
                    key={m.id}
                    className="py-4"
                    style={{ borderBottom: idx < messages.length - 1 ? "1px solid var(--border)" : undefined }}
                  >
                    <header className="flex items-center gap-3 mb-2.5">
                      <Avatar kind={out ? "agent" : "scammer"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {out ? "Margaret Hollis" : "Scam sender"}
                          </span>
                          {out && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1"
                              style={{ background: "var(--ai-soft)", color: "var(--ai)" }}
                            >
                              <span className="ai-spark">✦</span> AI agent
                            </span>
                          )}
                          {m.injection_flag && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-semibold tracking-wide"
                              style={{ background: "var(--danger)", color: "var(--danger-ink)" }}
                            >
                              INJECTION BLOCKED
                            </span>
                          )}
                        </div>
                        <div className="text-xs mono truncate" style={{ color: "var(--faint)" }}>
                          {out ? "margaret@honeypot.inbox" : current?.counterparty}
                        </div>
                      </div>
                      <span className="text-xs mono shrink-0" style={{ color: "var(--faint)" }}>
                        {clock(m.created_at)}
                      </span>
                    </header>
                    <div
                      className="text-sm leading-relaxed whitespace-pre-wrap pl-[46px]"
                      style={{ color: out ? "var(--text)" : "var(--text)" }}
                    >
                      {m.body}
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Indicators + actions */}
            <div className="shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="px-6 py-2.5 text-xs uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--faint)" }}>
                <span style={{ color: "var(--ai)" }}>✦</span> AI-extracted indicators · {currentIocs.length}
              </div>
              <div className="px-6 pb-3 max-h-36 overflow-y-auto space-y-2">
                {currentIocs.map((i) => (
                  <div key={i.id} className="flex items-center gap-2.5">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0"
                      style={{ color: SEV_COLOR[i.severity], border: `1px solid ${SEV_COLOR[i.severity]}` }}
                    >
                      {i.type}
                    </span>
                    <span className="text-sm mono break-all flex-1">{i.value}</span>
                    <span className="text-[10px] mono shrink-0" style={{ color: "var(--ai)" }}>
                      {Math.round(Number(i.confidence) * 100)}%
                    </span>
                  </div>
                ))}
                {!currentIocs.length && (
                  <p className="text-sm" style={{ color: "var(--faint)" }}>
                    No indicators yet.
                  </p>
                )}
              </div>
              <div className="px-6 py-4 flex gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                <button
                  onClick={draftReport}
                  disabled={drafting || !currentIocs.length}
                  className="flex-1 text-sm px-3 py-2.5 rounded-xl font-medium disabled:opacity-40 transition-opacity"
                  style={{ background: "var(--accent)", color: "#032012" }}
                >
                  {drafting ? "Drafting…" : "Draft takedown report"}
                </button>
                <a
                  href="/api/report"
                  className="text-sm px-4 py-2.5 rounded-xl hover:bg-[var(--glass-2)] transition-colors"
                  style={{ border: "1px solid var(--border-hi)" }}
                >
                  Export IOCs
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function aiAssessment(iocs: Ioc[]): { summary: string; confidence: string } {
  if (!iocs.length)
    return { summary: "Engaging the sender to elicit operational details. No indicators extracted yet.", confidence: "assessing" };
  const hasPay = iocs.some(isPaymentIoc);
  const hasUrl = iocs.some((i) => i.type === "url");
  const kind = hasPay
    ? "payment-transfer scam"
    : hasUrl
    ? "phishing / credential-harvesting scam"
    : "advance-fee lure";
  const sev = topSeverity(iocs);
  const confidence = sev === "critical" || sev === "high" ? "high" : sev === "medium" ? "medium" : "low";
  const dest = iocs.find(isPaymentIoc);
  const tail = dest
    ? ` Payment destination revealed (${dest.type}) — thread escalated and reportable.`
    : " Continuing to extract a payment destination.";
  return {
    summary: `Classified as a ${kind} from ${iocs.length} extracted indicator${iocs.length === 1 ? "" : "s"}.${tail}`,
    confidence,
  };
}

function Avatar({ kind }: { kind: "scammer" | "agent" }) {
  const scammer = kind === "scammer";
  return (
    <span
      className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0"
      style={{
        background: scammer ? "color-mix(in srgb, var(--danger) 22%, transparent)" : "color-mix(in srgb, var(--accent) 22%, transparent)",
        border: `1px solid ${scammer ? "color-mix(in srgb, var(--danger) 40%, transparent)" : "color-mix(in srgb, var(--accent) 40%, transparent)"}`,
      }}
    >
      {scammer ? "😈" : "🕵"}
    </span>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="text-right">
      <div className="text-lg font-semibold mono" style={{ color: accent ?? "var(--text)" }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: "var(--faint)" }}>
        {label}
      </div>
    </div>
  );
}
