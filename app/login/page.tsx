"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError("Invalid credentials.");
        setPassword("");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const input: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 14,
    padding: "11px 13px",
    borderRadius: 12,
    background: "var(--glass-2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    outline: "none",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ position: "relative", zIndex: 1 }}>
      {/* Office-chaos goose background */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: -1,
          backgroundImage: "url(/login-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div aria-hidden className="fixed inset-0 pointer-events-none" style={{ zIndex: -1, background: "rgba(6,7,9,0.68)" }} />
      <div className="glass-card w-full max-w-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl" style={{ background: "var(--glass-2)", border: "1px solid var(--border)" }}>
            🦢
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">GooseGuard</div>
            <div className="text-xs" style={{ color: "var(--faint)" }}>Secure sign-in</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider" style={{ color: "var(--faint)" }}>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} style={{ ...input, marginTop: 6 }} autoFocus autoCapitalize="off" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider" style={{ color: "var(--faint)" }}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...input, marginTop: 6 }} />
          </div>
          {error && (
            <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)" }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full text-sm px-3 py-3 rounded-xl font-semibold disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#032012" }}
          >
            {loading ? "Signing in…" : "🔒 Sign in"}
          </button>
        </form>

        <p className="text-xs mt-5 text-center" style={{ color: "var(--faint)" }}>
          Demo access — username <span className="mono" style={{ color: "var(--muted)" }}>demo</span> · password <span className="mono" style={{ color: "var(--muted)" }}>demo</span>
        </p>
      </div>
    </div>
  );
}
