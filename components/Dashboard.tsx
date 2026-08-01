"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import type { Thread, Message, Ioc } from "@/lib/types";
import { STAGES, type Stage, stageOf, topSeverity, isPaymentIoc, ago } from "@/lib/stage";
import Honeypots from "@/components/Honeypots";

const SEV_COLOR: Record<Ioc["severity"], string> = {
  low: "var(--muted)",
  medium: "var(--warn)",
  high: "#fb923c",
  critical: "var(--danger)",
};
const LANES: { stage: Stage; label: string; color: string }[] = [
  { stage: "Contact", label: "New Leads", color: "#5b8bf5" },
  { stage: "Engaging", label: "Engaging", color: "#8b7bf7" },
  { stage: "Extracting", label: "Intel Gathering", color: "#22d3ee" },
  { stage: "Escalated", label: "Reporting", color: "#f5c451" },
  { stage: "Reported", label: "Closed", color: "#59e08a" },
];
const TABS = ["Dashboard", "Emails", "Calls", "Kanban", "Intel", "Honeypots", "Reports"] as const;
type Tab = (typeof TABS)[number];

type ReportRow = { id: string; thread_id: string; created_at: string; status: string; target: string | null; draft_body: string };

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function fmtDur(min: number) {
  const s = Math.round(min * 60);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
function hoursMins(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}
function hourlyCumulative(events: { at: string; val: number }[]) {
  const b = new Array(24).fill(0);
  for (const e of events) b[new Date(e.at).getHours()] += e.val;
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < 24; i++) {
    acc += b[i];
    out.push(acc);
  }
  return out;
}
function statusFromStage(s: Stage): { label: string; tone: string } {
  switch (s) {
    case "Contact": return { label: "Queued", tone: "var(--faint)" };
    case "Engaging": return { label: "Engaging", tone: "#5b8bf5" };
    case "Extracting": return { label: "Investigating", tone: "#22d3ee" };
    case "Escalated": return { label: "Reporting", tone: "var(--warn)" };
    case "Reported": return { label: "Completed", tone: "var(--accent)" };
  }
}
function scoreOf(sev: Ioc["severity"] | null): { label: string; tone: string } {
  if (sev === "critical" || sev === "high") return { label: "High", tone: "var(--danger)" };
  if (sev === "medium") return { label: "Medium", tone: "var(--warn)" };
  return { label: "Low", tone: "var(--faint)" };
}

export default function Dashboard() {
  const db = useMemo(() => supabaseBrowser(), []);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [iocs, setIocs] = useState<Ioc[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [hpAttempts, setHpAttempts] = useState<{ id: string; username: string | null; created_at: string }[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [tab, setTab] = useState<Tab>("Dashboard");

  const load = useCallback(async () => {
    const [{ data: t }, { data: i }, { data: r }, { data: hp }] = await Promise.all([
      db.from("threads").select("*").order("last_at", { ascending: false }),
      db.from("iocs").select("*").order("created_at", { ascending: false }),
      db.from("reports").select("id, thread_id, created_at, status, target, draft_body"),
      db.from("honeypot_attempts").select("id, username, created_at").order("created_at", { ascending: false }),
    ]);
    setThreads(t ?? []);
    setIocs(i ?? []);
    setReports((r ?? []) as ReportRow[]);
    setHpAttempts(hp ?? []);
  }, [db]);

  const loadMessages = useCallback(
    async (id: string) => {
      const { data } = await db.from("messages").select("*").eq("thread_id", id).order("created_at", { ascending: true });
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
      .on("postgres_changes", { event: "*", schema: "public", table: "honeypot_attempts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, load)
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
    () => threads.map((t) => ({ t, stage: stageOf(t, iocsByThread.get(t.id) ?? [], reportedSet.has(t.id)) })),
    [threads, iocsByThread, reportedSet]
  );

  const totalMinutes = threads.reduce((a, t) => a + Number(t.minutes_wasted), 0);
  const creds = useMemo(() => hpAttempts.filter((a) => a.username !== "[ADMIN PAGE VIEWED]"), [hpAttempts]);
  const credsToday = creds.filter((a) => new Date(a.created_at).toDateString() === new Date().toDateString()).length;
  const iocByType = useMemo(() => {
    const m: Record<string, number> = { bank: 0, phone: 0, wallet: 0, url: 0, other: 0, email: 0 };
    for (const i of iocs) m[i.type] = (m[i.type] ?? 0) + 1;
    return m;
  }, [iocs]);

  const emailThreads = withStage.filter((x) => x.t.channel === "email");
  const voiceThreads = withStage.filter((x) => x.t.channel === "voice");

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
    } catch {
      alert("Could not draft report — network error.");
    } finally {
      setDrafting(false);
    }
  }

  async function approveReport(reportId: string) {
    const res = await fetch("/api/report", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId }),
    });
    if (res.ok) await load();
    else alert("Could not approve report.");
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const open = (id: string) => setSelected(id);

  return (
    <div className="min-h-screen" style={{ position: "relative", zIndex: 1 }}>
      {/* Top nav */}
      <header className="flex items-center justify-between px-6 py-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl" style={{ background: "var(--glass-2)", border: "1px solid var(--border)" }}>
            🦢
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">GooseGuard</div>
            <div className="text-xs" style={{ color: "var(--faint)" }}>
              We protect your territory.
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3.5 py-2 rounded-lg text-sm transition-colors"
              style={
                tab === t
                  ? { color: "var(--text)", background: "var(--glass-2)", fontWeight: 600 }
                  : { color: "var(--muted)" }
              }
            >
              {t}
            </button>
          ))}
        </nav>
        <button
          onClick={logout}
          title="Sign out"
          className="flex items-center gap-2 px-2 py-1.5 rounded-full hover:opacity-80"
          style={{ background: "var(--glass-2)", border: "1px solid var(--border)" }}
        >
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: "var(--ai)", color: "#fff" }}>
            A
          </span>
          <span className="text-sm">Analyst</span>
          <span className="text-xs" style={{ color: "var(--faint)" }}>⏻</span>
        </button>
      </header>

      <main className="px-6 pb-8 space-y-4">
        {tab === "Dashboard" && (
          <>
            {/* Stat cards */}
            <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1.1fr" }}>
              <StatCard title="Time Wasted Today" icon="⏱" goose="/goose-worker.jpeg">
                <div className="text-5xl font-bold tracking-tight">{hoursMins(totalMinutes)}</div>
                <div className="text-xs mt-1" style={{ color: "var(--faint)" }}>Across all scammers</div>
              </StatCard>
              <StatCard title="Credentials Captured" icon="🎣" goose="/goose-hoodie.jpeg" bg="#0f0d0e">
                <div className="flex items-center gap-2">
                  <div className="text-5xl font-bold tracking-tight">{creds.length}</div>
                  {credsToday > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: "color-mix(in srgb, var(--danger) 16%, transparent)", color: "var(--danger)" }}>
                      +{credsToday} today
                    </span>
                  )}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--faint)" }}>Attacker logins captured on live decoys</div>
              </StatCard>
              <StatCard title="Intel Extracted" icon="🗄" goose="/goose-callcentre.jpeg">
                <div className="flex gap-6">
                  <div>
                    <div className="text-4xl font-bold tracking-tight">{iocs.length}</div>
                    <div className="text-xs" style={{ color: "var(--faint)" }}>Total indicators</div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {[
                      ["Bank Accounts", iocByType.bank],
                      ["Phone Numbers", iocByType.phone],
                      ["Crypto Wallets", iocByType.wallet],
                      ["Phishing URLs", iocByType.url],
                      ["Other IOCs", iocByType.other + iocByType.email],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between text-sm">
                        <span style={{ color: "var(--muted)" }}>{k}</span>
                        <span className="mono">{v as number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </StatCard>
            </div>

            {/* Recent emails + call history */}
            <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Panel title="Recent Scam Emails" icon="✉" onViewAll={() => setTab("Emails")}>
                <EmailTable rows={emailThreads.slice(0, 6)} iocsByThread={iocsByThread} onOpen={open} />
              </Panel>
              <Panel title="Call History" icon="📞" onViewAll={() => setTab("Calls")}>
                <CallTable rows={voiceThreads.slice(0, 6)} onOpen={open} />
              </Panel>
            </div>

            {/* Investigation board */}
            <Panel title="Investigation Board" icon="🗂">
              <Board withStage={withStage} iocsByThread={iocsByThread} onOpen={open} />
            </Panel>
          </>
        )}

        {tab === "Emails" && (
          <Panel title="All Scam Emails" icon="✉">
            <EmailTable rows={emailThreads} iocsByThread={iocsByThread} onOpen={open} />
          </Panel>
        )}
        {tab === "Calls" && (
          <Panel title="All Calls" icon="📞">
            <CallTable rows={voiceThreads} onOpen={open} />
          </Panel>
        )}
        {tab === "Kanban" && (
          <Panel title="Investigation Board" icon="🗂">
            <Board withStage={withStage} iocsByThread={iocsByThread} onOpen={open} tall />
          </Panel>
        )}
        {tab === "Intel" && (
          <Panel title="Extracted Indicators" icon="🗄">
            <div className="flex justify-end mb-3">
              <a href="/api/report" className="text-xs px-3 py-1.5 rounded-lg hover:bg-[var(--glass-2)]" style={{ border: "1px solid var(--border)" }}>
                Export all (CSV)
              </a>
            </div>
            <IntelTable iocs={iocs} threadById={threadById} onOpen={open} />
          </Panel>
        )}
        {tab === "Honeypots" && <Honeypots />}
        {tab === "Reports" && (
          <Panel title="Takedown Reports" icon="📄">
            <ReportsView reports={reports} threadById={threadById} onOpen={open} onApprove={approveReport} />
          </Panel>
        )}
      </main>

      {/* Email reader drawer */}
      {selected && (
        <div className="fixed inset-0 z-20 flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 backdrop-blur-scrim" />
          <div className="drawer drawer-panel relative h-full w-full max-w-[600px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight leading-snug" style={{ textWrap: "balance" }}>{current?.subject}</h2>
                <button onClick={() => setSelected(null)} className="text-lg leading-none px-1 hover:opacity-70" style={{ color: "var(--muted)" }} aria-label="Close">✕</button>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <Avatar kind="scammer" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Scam sender</span>
                    {currentEscalated && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold tracking-wide" style={{ background: "var(--danger)", color: "var(--danger-ink)" }}>PAYMENT REVEALED</span>}
                  </div>
                  <div className="text-xs mono truncate" style={{ color: "var(--muted)" }}>{current?.counterparty}</div>
                </div>
                <span className="text-xs" style={{ color: "var(--faint)" }}>{current?.channel === "voice" ? "📞 voice" : "✉ email"}</span>
              </div>
            </div>

            <div className="px-6 pt-4 shrink-0">
              <div className="ai-banner rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="ai-spark text-sm" style={{ color: "var(--ai)" }}>✦</span>
                  <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--ai)" }}>AI assessment</span>
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase" style={{ color: "var(--ai)", border: "1px solid color-mix(in srgb, var(--ai) 40%, transparent)" }}>{ai.confidence} confidence</span>
                </div>
                <p className="text-sm leading-relaxed">{ai.summary}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pt-2">
              {messages.map((m, idx) => {
                const out = m.direction === "outbound";
                return (
                  <article key={m.id} className="py-4" style={{ borderBottom: idx < messages.length - 1 ? "1px solid var(--border)" : undefined }}>
                    <header className="flex items-center gap-3 mb-2.5">
                      <Avatar kind={out ? "agent" : "scammer"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{out ? "Margaret Hollis" : "Scam sender"}</span>
                          {out && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1" style={{ background: "var(--ai-soft)", color: "var(--ai)" }}><span className="ai-spark">✦</span> AI agent</span>}
                          {m.injection_flag && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold tracking-wide" style={{ background: "var(--danger)", color: "var(--danger-ink)" }}>INJECTION BLOCKED</span>}
                        </div>
                        <div className="text-xs mono truncate" style={{ color: "var(--faint)" }}>{out ? "margaret@honeypot.inbox" : current?.counterparty}</div>
                      </div>
                      <span className="text-xs mono shrink-0" style={{ color: "var(--faint)" }}>{clock(m.created_at)}</span>
                    </header>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap pl-[46px]">{m.body}</div>
                  </article>
                );
              })}
            </div>

            <div className="shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="px-6 py-2.5 text-xs uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--faint)" }}>
                <span style={{ color: "var(--ai)" }}>✦</span> AI-extracted indicators · {currentIocs.length}
              </div>
              <div className="px-6 pb-3 max-h-36 overflow-y-auto space-y-2">
                {currentIocs.map((i) => (
                  <div key={i.id} className="flex items-center gap-2.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0" style={{ color: SEV_COLOR[i.severity], border: `1px solid ${SEV_COLOR[i.severity]}` }}>{i.type}</span>
                    <span className="text-sm mono break-all flex-1">{i.value}</span>
                    <span className="text-[10px] mono shrink-0" style={{ color: "var(--ai)" }}>{Math.round(Number(i.confidence) * 100)}%</span>
                  </div>
                ))}
                {!currentIocs.length && <p className="text-sm" style={{ color: "var(--faint)" }}>No indicators yet.</p>}
              </div>
              <div className="px-6 py-4 flex gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                <button onClick={draftReport} disabled={drafting || !currentIocs.length} className="flex-1 text-sm px-3 py-2.5 rounded-xl font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "#032012" }}>{drafting ? "Drafting…" : "Draft takedown report"}</button>
                <a href={`/api/report?threadId=${selected}`} className="text-sm px-4 py-2.5 rounded-xl" style={{ border: "1px solid var(--border-hi)" }}>Export IOCs</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- widgets ---------- */

function StatCard({
  title,
  icon,
  children,
  goose = "/goose-worker.jpeg",
  flip = false,
  bg = "#000000",
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  goose?: string;
  flip?: boolean;
  bg?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: bg, border: "1px solid var(--border)" }}>
      <div className="flex items-stretch" style={{ minHeight: 172 }}>
        {/* Standing goose on its native black background, left side */}
        <div className="shrink-0 self-stretch" style={{ width: "38%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={goose}
            alt=""
            className="h-full w-full"
            style={{ objectFit: "contain", objectPosition: "left bottom", transform: flip ? "scaleX(-1)" : undefined }}
          />
        </div>
        {/* Stats on the right */}
        <div className="flex-1 p-5 flex flex-col justify-center min-w-0">
          <div className="flex items-center gap-2 mb-2 text-sm" style={{ color: "var(--muted)" }}>
            <span>{icon}</span>
            {title}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  const w = 100, h = 32;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - (v / max) * h] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: 72 }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Axis() {
  return (
    <div className="flex justify-between text-[10px] mono mt-1" style={{ color: "var(--faint)" }}>
      {["00:00", "06:00", "12:00", "18:00", "24:00"].map((t) => <span key={t}>{t}</span>)}
    </div>
  );
}

function Panel({ title, icon, children, onViewAll }: { title: string; icon: string; children: React.ReactNode; onViewAll?: () => void }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{icon}</span>
          {title}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="text-xs hover:opacity-80" style={{ color: "var(--ai)" }}>
            View all
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

type WS = { t: Thread; stage: Stage };

function EmailTable({ rows, iocsByThread, onOpen }: { rows: WS[]; iocsByThread: Map<string, Ioc[]>; onOpen: (id: string) => void }) {
  if (!rows.length) return <Empty text="No scam emails yet. Run the spam pull or wait for inbound." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider" style={{ color: "var(--faint)" }}>
          <Th>From</Th><Th>Subject</Th><Th>Received</Th><Th>Status</Th><Th>Score</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, stage }) => {
          const st = statusFromStage(stage);
          const sc = scoreOf(topSeverity(iocsByThread.get(t.id) ?? []));
          return (
            <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer hover:bg-[var(--glass-2)]" style={{ borderTop: "1px solid var(--border)" }}>
              <Td><span className="mono text-xs truncate block max-w-[180px]">{t.counterparty}</span></Td>
              <Td><span className="truncate block max-w-[220px]">{t.subject}</span></Td>
              <Td><span style={{ color: "var(--faint)" }}>{ago(t.last_at)} ago</span></Td>
              <Td><span style={{ color: st.tone }}>{st.label}</span></Td>
              <Td><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: sc.tone }} />{sc.label}</span></Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CallTable({ rows, onOpen }: { rows: WS[]; onOpen: (id: string) => void }) {
  if (!rows.length) return <Empty text="No calls yet. Dial the honeypot number to start one." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider" style={{ color: "var(--faint)" }}>
          <Th>Scammer</Th><Th>Number</Th><Th>Duration</Th><Th>Time</Th><Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, stage }) => {
          const st = statusFromStage(stage);
          return (
            <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer hover:bg-[var(--glass-2)]" style={{ borderTop: "1px solid var(--border)" }}>
              <Td>{t.subject?.replace(/^Voice call /, "Call ") ?? "Caller"}</Td>
              <Td><span className="mono text-xs">{t.counterparty}</span></Td>
              <Td className="mono">{fmtDur(Number(t.minutes_wasted))}</Td>
              <Td><span style={{ color: "var(--faint)" }}>{clock(t.started_at)}</span></Td>
              <Td><span style={{ color: st.tone }}>{st.label}</span></Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Board({ withStage, iocsByThread, onOpen, tall }: { withStage: WS[]; iocsByThread: Map<string, Ioc[]>; onOpen: (id: string) => void; tall?: boolean }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${LANES.length}, minmax(0,1fr))` }}>
      {LANES.map((lane) => {
        const items = withStage.filter((x) => x.stage === lane.stage);
        return (
          <div key={lane.stage} className="rounded-xl p-3" style={{ background: "var(--glass-2)", borderTop: `2px solid ${lane.color}` }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">{lane.label}</span>
              <span className="text-xs mono w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "var(--glass-2)", color: "var(--muted)" }}>{items.length}</span>
            </div>
            <div className={`space-y-2 overflow-y-auto ${tall ? "max-h-[60vh]" : "max-h-72"}`}>
              {items.map(({ t }) => {
                const pay = (iocsByThread.get(t.id) ?? []).find(isPaymentIoc);
                return (
                  <button key={t.id} onClick={() => onOpen(t.id)} className="glass-card w-full text-left p-3">
                    <div className="text-sm truncate">{t.subject}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs mono truncate max-w-[75%]" style={{ color: "var(--faint)" }}>{t.counterparty}</span>
                      <span>{t.channel === "voice" ? "📞" : "✉"}</span>
                    </div>
                    {pay && <div className="text-[10px] mono mt-1.5 px-1.5 py-0.5 rounded inline-block" style={{ background: "var(--danger)", color: "var(--danger-ink)" }}>{pay.type}</div>}
                  </button>
                );
              })}
              {!items.length && <div className="text-xs text-center py-3" style={{ color: "var(--faint)" }}>—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IntelTable({ iocs, threadById, onOpen }: { iocs: Ioc[]; threadById: Map<string, Thread>; onOpen: (id: string) => void }) {
  if (!iocs.length) return <Empty text="No indicators extracted yet." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider" style={{ color: "var(--faint)" }}>
          <Th>Type</Th><Th>Value</Th><Th>Severity</Th><Th>Confidence</Th><Th>Source</Th>
        </tr>
      </thead>
      <tbody>
        {iocs.map((i) => (
          <tr key={i.id} onClick={() => onOpen(i.thread_id)} className="cursor-pointer hover:bg-[var(--glass-2)]" style={{ borderTop: "1px solid var(--border)" }}>
            <Td><span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase" style={{ color: SEV_COLOR[i.severity], border: `1px solid ${SEV_COLOR[i.severity]}` }}>{i.type}</span></Td>
            <Td><span className="mono break-all">{i.value}</span></Td>
            <Td style={{ color: SEV_COLOR[i.severity] }}>{i.severity}</Td>
            <Td className="mono" style={{ color: "var(--ai)" }}>{Math.round(Number(i.confidence) * 100)}%</Td>
            <Td><span className="mono text-xs truncate block max-w-[160px]" style={{ color: "var(--faint)" }}>{threadById.get(i.thread_id)?.counterparty}</span></Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReportsView({ reports, threadById, onOpen, onApprove }: { reports: ReportRow[]; threadById: Map<string, Thread>; onOpen: (id: string) => void; onApprove: (reportId: string) => void }) {
  if (!reports.length) return <Empty text="No reports drafted yet. Open an escalated thread and draft one." />;
  return (
    <div className="space-y-3">
      {reports.map((r) => {
        const approved = r.status === "approved";
        return (
          <div key={r.id} className="rounded-xl p-4" style={{ background: "var(--glass-2)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-2 gap-3">
              <button onClick={() => onOpen(r.thread_id)} className="text-sm font-medium hover:opacity-80 text-left">
                {threadById.get(r.thread_id)?.counterparty ?? "thread"} → {r.target ?? "abuse-desk"}
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase"
                  style={approved ? { background: "var(--accent)", color: "#032012" } : { background: "var(--warn)", color: "#241c05" }}
                >
                  {r.status}
                </span>
                {!approved && (
                  <button
                    onClick={() => onApprove(r.id)}
                    className="text-xs px-3 py-1 rounded-lg font-medium"
                    style={{ background: "var(--accent)", color: "#032012" }}
                  >
                    Approve &amp; file
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--muted)" }}>{r.draft_body}</p>
          </div>
        );
      })}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm py-6 text-center" style={{ color: "var(--faint)" }}>{text}</p>;
}
const Th = ({ children }: { children: React.ReactNode }) => <th className="font-medium pb-2 pr-3">{children}</th>;
const Td = ({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
  <td className={`py-2.5 pr-3 ${className ?? ""}`} style={style}>{children}</td>
);

function aiAssessment(iocs: Ioc[]): { summary: string; confidence: string } {
  if (!iocs.length) return { summary: "Engaging the sender to elicit operational details. No indicators extracted yet.", confidence: "assessing" };
  const hasPay = iocs.some(isPaymentIoc);
  const hasUrl = iocs.some((i) => i.type === "url");
  const kind = hasPay ? "payment-transfer scam" : hasUrl ? "phishing / credential-harvesting scam" : "advance-fee lure";
  const sev = topSeverity(iocs);
  const confidence = sev === "critical" || sev === "high" ? "high" : sev === "medium" ? "medium" : "low";
  const dest = iocs.find(isPaymentIoc);
  const tail = dest ? ` Payment destination revealed (${dest.type}) — thread escalated and reportable.` : " Continuing to extract a payment destination.";
  return { summary: `Classified as a ${kind} from ${iocs.length} extracted indicator${iocs.length === 1 ? "" : "s"}.${tail}`, confidence };
}

function Avatar({ kind }: { kind: "scammer" | "agent" }) {
  const scammer = kind === "scammer";
  return (
    <span className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0" style={{
      background: scammer ? "color-mix(in srgb, var(--danger) 22%, transparent)" : "color-mix(in srgb, var(--accent) 22%, transparent)",
      border: `1px solid ${scammer ? "color-mix(in srgb, var(--danger) 40%, transparent)" : "color-mix(in srgb, var(--accent) 40%, transparent)"}`,
    }}>{scammer ? "😈" : "🕵"}</span>
  );
}
