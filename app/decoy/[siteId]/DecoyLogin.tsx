"use client";

import { useState, CSSProperties } from "react";

type Props = { siteId: string; template: "wordpress" | "drupal"; brand: string; accent?: string };

export default function DecoyLogin({ siteId, template, brand, accent }: Props) {
  const wpAccent = accent || "#2271b1";
  const drupalAccent = accent || "#0678be";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    // small delay for realism (feels like a real server round-trip)
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 500));
    try {
      const res = await fetch("/api/decoy/attempt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId, username, password }),
      });
      const data: { status: "invalid" | "redirect"; adminUrl?: string } = await res.json();
      if (data.status === "redirect" && data.adminUrl) {
        window.location.href = data.adminUrl;
        return;
      }
      setError(
        template === "drupal"
          ? "Unrecognized username or password. Forgot your password?"
          : `Error: The password you entered for the username ${username || "admin"} is incorrect.`
      );
      setPassword("");
    } catch {
      setError(
        template === "drupal"
          ? "Unrecognized username or password. Forgot your password?"
          : "Error: The password you entered is incorrect."
      );
    } finally {
      setLoading(false);
    }
  }

  if (template === "drupal") return <DrupalForm />;
  return <WordPressForm />;

  function WordPressForm() {
    const label: CSSProperties = {
      display: "block",
      fontSize: 14,
      lineHeight: "1.5",
      color: "#3c434a",
      marginBottom: 3,
    };
    const input: CSSProperties = {
      width: "100%",
      boxSizing: "border-box",
      fontSize: 24,
      lineHeight: 1.33333333,
      padding: "3px 8px",
      margin: "0 0 16px",
      border: "1px solid #8c8f94",
      borderRadius: 4,
      background: "#fff",
      color: "#2c3338",
      outline: "none",
    };
    return (
      <>
        {error && (
          <div
            role="alert"
            style={{
              background: "#fff",
              borderLeft: "4px solid #d63638",
              boxShadow: "0 1px 1px rgba(0,0,0,.04)",
              margin: "0 0 20px",
              padding: "12px",
              fontSize: 13,
              color: "#3c434a",
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="user_login" style={label}>
            Username or Email Address
          </label>
          <input
            id="user_login"
            name="log"
            type="text"
            autoCapitalize="off"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={input}
            autoFocus
          />
          <label htmlFor="user_pass" style={label}>
            Password
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="user_pass"
              name="pwd"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={input}
            />
          </div>
          <p style={{ margin: "0 0 24px", display: "flex", alignItems: "center" }}>
            <input
              id="rememberme"
              type="checkbox"
              style={{ marginRight: 6, width: 16, height: 16 }}
            />
            <label htmlFor="rememberme" style={{ fontSize: 13, color: "#3c434a" }}>
              Remember Me
            </label>
          </p>
          <p style={{ textAlign: "right", margin: 0 }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                background: wpAccent,
                borderColor: wpAccent,
                color: "#fff",
                border: `1px solid ${wpAccent}`,
                borderRadius: 3,
                cursor: loading ? "default" : "pointer",
                fontSize: 13,
                lineHeight: 2.15384615,
                padding: "0 12px",
                minHeight: 32,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Logging In…" : "Log In"}
            </button>
          </p>
        </form>
      </>
    );
  }

  function DrupalForm() {
    const label: CSSProperties = {
      display: "block",
      fontSize: 13,
      fontWeight: 700,
      color: "#43484c",
      marginBottom: 6,
    };
    const input: CSSProperties = {
      width: "100%",
      boxSizing: "border-box",
      fontSize: 14,
      padding: "8px 10px",
      margin: "0 0 18px",
      border: "1px solid #c9cbcd",
      borderRadius: 2,
      background: "#fff",
      color: "#2c3338",
      outline: "none",
    };
    return (
      <>
        {error && (
          <div
            role="alert"
            style={{
              background: "#fcf4f2",
              border: "1px solid #ed541d",
              borderLeft: "5px solid #e62600",
              margin: "0 0 20px",
              padding: "12px 15px",
              fontSize: 13,
              color: "#43484c",
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="edit-name" style={label}>
            Username <span style={{ color: "#e62600" }}>*</span>
          </label>
          <input
            id="edit-name"
            name="name"
            type="text"
            autoCapitalize="off"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={input}
            autoFocus
          />
          <label htmlFor="edit-pass" style={label}>
            Password <span style={{ color: "#e62600" }}>*</span>
          </label>
          <input
            id="edit-pass"
            name="pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={input}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              background: drupalAccent,
              color: "#fff",
              border: `1px solid ${drupalAccent}`,
              borderRadius: 20,
              cursor: loading ? "default" : "pointer",
              fontSize: 14,
              fontWeight: 700,
              padding: "9px 22px",
              marginTop: 4,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Logging in…" : "Log in"}
          </button>
        </form>
      </>
    );
  }
}
