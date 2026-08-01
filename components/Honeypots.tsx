"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { ago } from "@/lib/stage";

const SCAN_STEPS = [
  "Warming up the goose",
  "Resolving host",
  "Fetching landing page",
  "Extracting brand & logo",
  "Detecting CMS",
  "Generating decoy",
  "Deploying honeypot",
  "Ready",
];

type Template = "wordpress" | "drupal";
type Status = "holding" | "arming" | "active";

type Site = {
  id: string;
  template: Template;
  brand: string | null;
  mimic_url: string | null;
  status: Status;
  vm_url: string | null;
  created_at: string;
};

type Attempt = {
  id: string;
  site_id: string;
  username: string | null;
  password: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

type DataRow = {
  id: string;
  site_id: string;
  kind: string | null;
  created_at: string;
};

const TEMPLATE_LABEL: Record<Template, string> = { wordpress: "WP", drupal: "Drupal" };

const STATUS_STYLE: Record<Status, { label: string; color: string; pulse: boolean }> = {
  holding: { label: "Holding", color: "var(--faint)", pulse: false },
  arming: { label: "Arming", color: "var(--warn)", pulse: true },
  active: { label: "Active", color: "var(--accent)", pulse: false },
};

function shortUa(ua: string | null): string {
  if (!ua) return "unknown client";
  const m =
    ua.match(/(Firefox|Edg|OPR|Chrome|Safari|curl|python-requests|Go-http-client|Wget)[/ ]?[\d.]*/i);
  return m ? m[0] : ua.slice(0, 28);
}

export default function Honeypots() {
  const db = useMemo(() => supabaseBrowser(), []);
  const [sites, setSites] = useState<Site[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [dataRows, setDataRows] = useState<DataRow[]>([]);
  const [template, setTemplate] = useState<Template>("wordpress");
  const [mimicUrl, setMimicUrl] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [scan, setScan] = useState<{ target: string; step: number; done: boolean } | null>(null);
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startScan = useCallback((target: string) => {
    setScan({ target, step: 0, done: false });
    let i = 0;
    if (scanTimer.current) clearInterval(scanTimer.current);
    scanTimer.current = setInterval(() => {
      i = Math.min(i + 1, SCAN_STEPS.length - 2);
      setScan((s) => (s ? { ...s, step: i } : s));
    }, 650);
  }, []);
  const finishScan = useCallback(() => {
    if (scanTimer.current) clearInterval(scanTimer.current);
    setScan((s) => (s ? { ...s, step: SCAN_STEPS.length - 1, done: true } : s));
    setTimeout(() => setScan(null), 1000);
  }, []);

  const load = useCallback(async () => {
    const [{ data: s }, { data: a }, { data: d }] = await Promise.all([
      db.from("honeypot_sites").select("*").order("created_at", { ascending: false }),
      db.from("honeypot_attempts").select("*").order("created_at", { ascending: false }),
      db.from("honeypot_data").select("id, site_id, kind, created_at"),
    ]);
    setSites((s ?? []) as Site[]);
    setAttempts((a ?? []) as Attempt[]);
    setDataRows((d ?? []) as DataRow[]);
  }, [db]);

  useEffect(() => {
    load();
    const ch = db
      .channel("hp")
      .on("postgres_changes", { event: "*", schema: "public", table: "honeypot_sites" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "honeypot_attempts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "honeypot_data" }, load)
      .subscribe();
    return () => {
      db.removeChannel(ch);
    };
  }, [db, load]);

  const attemptsBySite = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attempts) m.set(a.site_id, (m.get(a.site_id) ?? 0) + 1);
    return m;
  }, [attempts]);
  const dataBySite = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dataRows) m.set(d.site_id, (m.get(d.site_id) ?? 0) + 1);
    return m;
  }, [dataRows]);
  const brandBySite = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sites) m.set(s.id, s.brand ?? TEMPLATE_LABEL[s.template]);
    return m;
  }, [sites]);

  const deploy = useCallback(
    async (t: Template) => {
      setDeploying(true);
      startScan(mimicUrl.trim() || `${t} login`);
      const win = window.open("", "_blank"); // open synchronously so it isn't popup-blocked
      try {
        const res = await fetch("/api/decoy/site", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ template: t, mimic_url: mimicUrl.trim() || undefined }),
        });
        const j = await res.json();
        if (!res.ok) {
          win?.close();
          alert(j?.error ?? "Could not deploy decoy");
          return;
        }
        setMimicUrl("");
        if (j?.url && win) win.location.href = j.url as string;
        else if (j?.url) window.open(j.url as string, "_blank");
        await load();
      } catch {
        win?.close();
        alert("Could not deploy decoy");
      } finally {
        finishScan();
        setDeploying(false);
      }
    },
    [mimicUrl, load, startScan, finishScan]
  );

  // Deploy + immediately arm (generate fake data, activate) and open the fake admin.
  const deployArmed = useCallback(async () => {
    setDeploying(true);
    startScan(mimicUrl.trim() || `${template} login`);
    const win = window.open("", "_blank"); // open synchronously so it isn't popup-blocked
    try {
      const res = await fetch("/api/decoy/site", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template, mimic_url: mimicUrl.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok) {
        win?.close();
        alert(j?.error ?? "Could not deploy decoy");
        return;
      }
      const spin = await fetch("/api/decoy/spinup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: j.siteId }),
      });
      if (!spin.ok) {
        win?.close();
        alert("Decoy deployed, but arming (fake data) failed. Open it from the site card.");
        await load();
        return;
      }
      setMimicUrl("");
      const adminUrl = "/decoy/" + j.siteId + "/admin";
      if (win) win.location.href = adminUrl;
      else window.open(adminUrl, "_blank");
      await load();
    } catch {
      win?.close();
      alert("Could not deploy demo");
    } finally {
      finishScan();
      setDeploying(false);
    }
  }, [template, mimicUrl, load, startScan, finishScan]);

  return (
    <div className="space-y-4">
      {scan && <ScanOverlay scan={scan} />}
      {/* Header + deploy control */}
      <div className="glass-card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>🍯</span>
            <div>
              <div className="text-base font-semibold tracking-tight">Honeypots</div>
              <div className="text-xs" style={{ color: "var(--faint)" }}>
                Deploy decoy logins and capture attacker credentials in real time.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DeployControl
              template={template}
              setTemplate={setTemplate}
              mimicUrl={mimicUrl}
              setMimicUrl={setMimicUrl}
              deploy={deploy}
              deploying={deploying}
            />
            <button
              onClick={deployArmed}
              disabled={deploying}
              className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
              style={{ background: "var(--ai)", color: "#fff" }}
            >
              {deploying ? "Working…" : "⚡ Deploy armed demo"}
            </button>
          </div>
        </div>
      </div>

      {sites.length === 0 ? (
        <EmptyState deploy={deploy} deploying={deploying} />
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
          {/* Site cards grid */}
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {sites.map((s) => (
              <SiteCard
                key={s.id}
                site={s}
                attempts={attemptsBySite.get(s.id) ?? 0}
                dataCount={dataBySite.get(s.id) ?? 0}
              />
            ))}
          </div>

          {/* Live capture feed */}
          <CaptureFeed attempts={attempts} brandBySite={brandBySite} />
        </div>
      )}
    </div>
  );
}

/* ---------- widgets ---------- */

function DeployControl({
  template,
  setTemplate,
  mimicUrl,
  setMimicUrl,
  deploy,
  deploying,
}: {
  template: Template;
  setTemplate: (t: Template) => void;
  mimicUrl: string;
  setMimicUrl: (v: string) => void;
  deploy: (t: Template) => void;
  deploying: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        value={mimicUrl}
        onChange={(e) => setMimicUrl(e.target.value)}
        placeholder="mimic URL (optional)"
        className="text-sm px-3 py-2 rounded-lg mono outline-none w-56"
        style={{ background: "var(--glass-2)", border: "1px solid var(--border)", color: "var(--text)" }}
      />
      <select
        value={template}
        onChange={(e) => setTemplate(e.target.value as Template)}
        className="text-sm px-3 py-2 rounded-lg outline-none"
        style={{ background: "var(--glass-2)", border: "1px solid var(--border)", color: "var(--text)" }}
      >
        <option value="wordpress">WordPress</option>
        <option value="drupal">Drupal</option>
      </select>
      <button
        onClick={() => deploy(template)}
        disabled={deploying}
        className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
        style={{ background: "var(--accent)", color: "#032012" }}
      >
        {deploying ? "Deploying…" : "+ Deploy decoy"}
      </button>
    </div>
  );
}

function ScanOverlay({ scan }: { scan: { target: string; step: number; done: boolean } }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-6">
      <div className="absolute inset-0 backdrop-blur-scrim" />
      <div className="glass-card relative w-full max-w-md p-7">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-lg">🦢</span>
          <div className="text-sm font-semibold">{scan.done ? "Honeypot deployed" : "Deploying honeypot"}</div>
        </div>
        <div className="text-xs mono truncate mb-5" style={{ color: "var(--faint)" }}>{scan.target}</div>

        <div className="relative mx-auto mb-6" style={{ width: 118, height: 118 }}>
          <div className="absolute rounded-full" style={{ inset: 0, border: "1px solid var(--border)" }} />
          <div className="absolute rounded-full" style={{ inset: "22%", border: "1px solid var(--border)" }} />
          <div className="absolute rounded-full" style={{ inset: "44%", border: "1px solid var(--border)" }} />
          {!scan.done && (
            <div
              className="absolute radar"
              style={{
                inset: 0,
                borderRadius: "50%",
                background: "conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--accent) 40%, transparent) 55deg, transparent 90deg)",
              }}
            />
          )}
          <div className="absolute flex items-center justify-center text-2xl" style={{ inset: 0 }}>
            {scan.done ? "🎣" : "📡"}
          </div>
        </div>

        <div className="space-y-2">
          {SCAN_STEPS.map((s, i) => {
            const state = scan.done || i < scan.step ? "done" : i === scan.step ? "active" : "pending";
            return (
              <div key={s} className="flex items-center gap-2.5 text-sm step-in" style={{ opacity: state === "pending" ? 0.4 : 1 }}>
                <span className="w-5 text-center">
                  {state === "done" ? (
                    <span style={{ color: "var(--accent)" }}>✓</span>
                  ) : state === "active" ? (
                    <span className="inline-block radar" style={{ color: "var(--ai)" }}>◠</span>
                  ) : (
                    <span style={{ color: "var(--faint)" }}>○</span>
                  )}
                </span>
                <span style={{ color: state === "active" ? "var(--text)" : "var(--muted)" }}>
                  {s}
                  {state === "active" ? "…" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TemplateBadge({ template }: { template: Template }) {
  const wp = template === "wordpress";
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
      style={{
        color: wp ? "#5b8bf5" : "#22d3ee",
        border: `1px solid ${wp ? "#5b8bf5" : "#22d3ee"}`,
      }}
    >
      {TEMPLATE_LABEL[template]}
    </span>
  );
}

function StatusPill({ status }: { status: Status }) {
  const st = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: st.color }}>
      <span
        className={`w-2 h-2 rounded-full ${st.pulse ? "live-dot" : ""}`}
        style={{ background: st.color }}
      />
      {st.label}
    </span>
  );
}

function SiteCard({
  site,
  attempts,
  dataCount,
}: {
  site: Site;
  attempts: number;
  dataCount: number;
}) {
  const brand = site.brand ?? TEMPLATE_LABEL[site.template];
  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{brand}</span>
            <TemplateBadge template={site.template} />
          </div>
          {site.mimic_url && (
            <div className="text-xs mono truncate mt-1" style={{ color: "var(--faint)" }} title={site.mimic_url}>
              {site.mimic_url}
            </div>
          )}
        </div>
        <StatusPill status={site.status} />
      </div>

      <div className="flex items-center gap-4 text-sm">
        <div>
          <div className="text-xl font-bold tracking-tight mono">{attempts}</div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--faint)" }}>
            Attempts
          </div>
        </div>
        <div>
          <div className="text-xl font-bold tracking-tight mono">{dataCount}</div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--faint)" }}>
            Captured data
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-auto">
        <a
          href={`/decoy/${site.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-2.5 py-1.5 rounded-lg"
          style={{ border: "1px solid var(--border-hi)", color: "var(--text)" }}
        >
          Open holding page
        </a>
        {site.status === "active" && (
          <a
            href={`/decoy/${site.id}/admin`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-2.5 py-1.5 rounded-lg font-medium"
            style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)" }}
          >
            Open fake admin
          </a>
        )}
        {site.vm_url && (
          <a
            href={site.vm_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-2.5 py-1.5 rounded-lg"
            style={{ border: "1px solid var(--border-hi)", color: "var(--ai)" }}
          >
            VM ↗
          </a>
        )}
      </div>
    </div>
  );
}

function CaptureFeed({
  attempts,
  brandBySite,
}: {
  attempts: Attempt[];
  brandBySite: Map<string, string>;
}) {
  return (
    <div className="glass-card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>🎣</span> Live capture feed
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: "var(--accent)" }}>
          <span className="w-2 h-2 rounded-full live-dot" style={{ background: "var(--accent)" }} />
          live
        </span>
      </div>

      {attempts.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: "var(--faint)" }}>
          No credentials captured yet. Attacker submissions appear here the moment they land.
        </p>
      ) : (
        <div className="space-y-2 overflow-y-auto max-h-[70vh] pr-1">
          {attempts.map((a) => (
            <div
              key={a.id}
              className="rounded-xl p-3"
              style={{ background: "var(--glass-2)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                  🎣 captured
                </span>
                <span className="text-[11px] mono" style={{ color: "var(--faint)" }}>
                  {ago(a.created_at)} ago
                </span>
              </div>
              <div className="grid gap-1 text-sm" style={{ gridTemplateColumns: "auto 1fr" }}>
                <span style={{ color: "var(--faint)" }}>user</span>
                <span className="mono break-all">{a.username || "—"}</span>
                <span style={{ color: "var(--faint)" }}>pass</span>
                <span className="mono break-all" style={{ color: "var(--danger)" }}>{a.password || "—"}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
                <span className="mono">{a.ip || "no-ip"}</span>
                <span style={{ color: "var(--faint)" }}>·</span>
                <span className="mono truncate" title={a.user_agent ?? undefined}>{shortUa(a.user_agent)}</span>
                <span style={{ color: "var(--faint)" }}>·</span>
                <span>{brandBySite.get(a.site_id) ?? "decoy"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ deploy, deploying }: { deploy: (t: Template) => void; deploying: boolean }) {
  return (
    <div className="glass-card p-8 text-center">
      <div className="text-4xl mb-3">🍯</div>
      <h3 className="text-base font-semibold mb-2">No decoys deployed yet</h3>
      <p className="text-sm mx-auto max-w-md leading-relaxed" style={{ color: "var(--muted)" }}>
        Deploy a decoy WordPress or Drupal login. When an attacker submits credentials, GooseGuard
        captures them and spins up a pre-populated fake admin to keep them busy.
      </p>
      <div className="flex items-center justify-center gap-2 mt-5">
        <button
          onClick={() => deploy("wordpress")}
          disabled={deploying}
          className="text-sm px-4 py-2.5 rounded-xl font-medium disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#032012" }}
        >
          {deploying ? "Deploying…" : "Deploy WordPress decoy"}
        </button>
        <button
          onClick={() => deploy("drupal")}
          disabled={deploying}
          className="text-sm px-4 py-2.5 rounded-xl font-medium disabled:opacity-40"
          style={{ border: "1px solid var(--border-hi)", color: "var(--text)" }}
        >
          {deploying ? "Deploying…" : "Deploy Drupal decoy"}
        </button>
      </div>
    </div>
  );
}
