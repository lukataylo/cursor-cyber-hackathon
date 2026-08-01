import { supabaseAdmin } from "@/lib/supabase";
import { CSSProperties } from "react";

type Site = {
  id: string;
  template: "wordpress" | "drupal";
  brand: string;
};

type DataRow = {
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

// Safely coerce an unknown jsonb field to a display string.
function s(v: unknown, fallback = "—"): string {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

export default async function AdminPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const db = supabaseAdmin();

  const { data: siteData } = await db
    .from("honeypot_sites")
    .select("id, template, brand")
    .eq("id", siteId)
    .maybeSingle();
  const site = siteData as Site | null;

  if (!site) {
    return (
      <div style={{ padding: 40, fontFamily: "sans-serif" }}>
        <h1>404 — Not Found</h1>
      </div>
    );
  }

  const { data: rows } = await db
    .from("honeypot_data")
    .select("kind, payload, created_at")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });
  const data = (rows as DataRow[] | null) ?? [];

  // Log the fact that the attacker reached the admin panel (continued engagement).
  await db.from("honeypot_attempts").insert({
    site_id: siteId,
    username: "[ADMIN PAGE VIEWED]",
    password: "",
    ip: "internal",
    user_agent: "admin-view",
  });

  const posts = data.filter((r) => r.kind === "post");
  const users = data.filter((r) => r.kind === "user");
  const orders = data.filter((r) => r.kind === "order");
  const comments = data.filter((r) => r.kind === "comment");
  const plugins = data.filter((r) => r.kind === "plugin");

  if (site.template === "drupal") {
    return (
      <DrupalAdmin
        site={site}
        posts={posts}
        users={users}
        comments={comments}
      />
    );
  }

  return (
    <WpAdmin
      site={site}
      posts={posts}
      users={users}
      orders={orders}
      comments={comments}
      plugins={plugins}
    />
  );
}

/* ------------------------------ WordPress ------------------------------ */

function WpAdmin({
  site,
  posts,
  users,
  orders,
  comments,
  plugins,
}: {
  site: Site;
  posts: DataRow[];
  users: DataRow[];
  orders: DataRow[];
  comments: DataRow[];
  plugins: DataRow[];
}) {
  const menu = [
    { label: "Dashboard", icon: "▤", active: true },
    { label: "Posts", icon: "📌", count: posts.length },
    { label: "Media", icon: "🖼" },
    { label: "Pages", icon: "📄" },
    { label: "Comments", icon: "💬", count: comments.length },
    ...(orders.length ? [{ label: "WooCommerce", icon: "🛒" }] : []),
    ...(orders.length ? [{ label: "Products", icon: "🏷" }] : []),
    { label: "Appearance", icon: "🎨" },
    { label: "Plugins", icon: "🔌", count: plugins.length },
    { label: "Users", icon: "👥", count: users.length },
    { label: "Tools", icon: "🛠" },
    { label: "Settings", icon: "⚙" },
  ];

  const font =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif';

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f1", fontFamily: font }}>
      {/* Sidebar */}
      <div style={{ width: 160, background: "#1d2327", color: "#f0f0f1", flexShrink: 0 }}>
        <div
          style={{
            height: 46,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            fontSize: 13,
            color: "#fff",
            borderBottom: "1px solid #2c3338",
          }}
        >
          <span style={{ fontSize: 18, marginRight: 8 }}>ⓦ</span> {site.brand}
        </div>
        {menu.map((m) => (
          <div
            key={m.label}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "9px 12px",
              fontSize: 14,
              color: m.active ? "#fff" : "#c3c4c7",
              background: m.active ? "#2271b1" : "transparent",
              cursor: "pointer",
            }}
          >
            <span style={{ width: 20, fontSize: 13 }}>{m.icon}</span>
            <span style={{ flex: 1 }}>{m.label}</span>
            {typeof m.count === "number" && m.count > 0 && (
              <span
                style={{
                  background: "#d63638",
                  color: "#fff",
                  borderRadius: 10,
                  fontSize: 11,
                  padding: "1px 7px",
                }}
              >
                {m.count}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top admin bar */}
        <div
          style={{
            height: 32,
            background: "#1d2327",
            color: "#c3c4c7",
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            fontSize: 13,
          }}
        >
          <span style={{ marginRight: 16 }}>🏠 {site.brand}</span>
          <span style={{ marginRight: 16 }}>💬 {comments.length}</span>
          <span style={{ marginRight: 16 }}>+ New</span>
          <span style={{ marginLeft: "auto" }}>Howdy, admin ▾</span>
        </div>

        <div style={{ padding: "20px 22px" }}>
          <h1 style={{ fontSize: 23, fontWeight: 400, color: "#1d2327", margin: "0 0 20px" }}>
            Dashboard
          </h1>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 20,
              alignItems: "start",
            }}
          >
            {/* At a Glance */}
            <Card title="At a Glance">
              <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 14, color: "#50575e" }}>
                <Glance label="Posts" n={posts.length} icon="📌" />
                <Glance label="Pages" n={Math.max(2, Math.round(posts.length / 3))} icon="📄" />
                <Glance label="Comments" n={comments.length} icon="💬" />
                <Glance label="Users" n={users.length} icon="👥" />
                {orders.length > 0 && <Glance label="Orders" n={orders.length} icon="🛒" />}
              </ul>
              <p style={{ margin: "14px 0 0", fontSize: 13, color: "#646970" }}>
                WordPress 6.5.2 running the <strong>Twenty Twenty-Four</strong> theme.
              </p>
            </Card>

            {/* Activity */}
            <Card title="Activity">
              <p style={{ margin: "0 0 8px", fontSize: 12, textTransform: "uppercase", color: "#646970", letterSpacing: ".5px" }}>
                Recently Published
              </p>
              {posts.slice(0, 5).map((p, i) => (
                <div key={i} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f0f0f1" }}>
                  <span style={{ color: "#646970", marginRight: 8 }}>{s(p.payload.date, fmtDate(p.created_at))}</span>
                  <a href="#" style={{ color: "#2271b1", textDecoration: "none" }}>
                    {s(p.payload.title, "Untitled")}
                  </a>
                </div>
              ))}
              {posts.length === 0 && <p style={{ fontSize: 13, color: "#646970" }}>No activity yet.</p>}
            </Card>
          </div>

          {/* Posts table */}
          {posts.length > 0 && (
            <Section title="Posts">
              <Table
                head={["Title", "Author", "Categories", "Date"]}
                rows={posts.map((p) => [
                  s(p.payload.title, "Untitled"),
                  s(p.payload.author, "admin"),
                  s(p.payload.category, "Uncategorized"),
                  s(p.payload.date, fmtDate(p.created_at)),
                ])}
                linkFirst
              />
            </Section>
          )}

          {/* WooCommerce Orders */}
          {orders.length > 0 && (
            <Section title="WooCommerce · Orders">
              <Table
                head={["Order", "Customer", "Status", "Total"]}
                rows={orders.map((o) => [
                  "#" + s(o.payload.number, "—"),
                  s(o.payload.customer, "Guest"),
                  s(o.payload.status, "Processing"),
                  s(o.payload.total, "$0.00"),
                ])}
                linkFirst
              />
            </Section>
          )}

          {/* Users table */}
          {users.length > 0 && (
            <Section title="Users">
              <Table
                head={["Username", "Email", "Role"]}
                rows={users.map((u) => [
                  s(u.payload.username, "user"),
                  s(u.payload.email, "—"),
                  s(u.payload.role, "Subscriber"),
                ])}
                linkFirst
              />
            </Section>
          )}

          {/* Plugins */}
          {plugins.length > 0 && (
            <Section title="Plugins">
              <Table
                head={["Plugin", "Version", "Status"]}
                rows={plugins.map((p) => [
                  s(p.payload.name, s(p.payload.title, "Plugin")),
                  s(p.payload.version, "1.0.0"),
                  s(p.payload.status, "Active"),
                ])}
                linkFirst
              />
            </Section>
          )}

          <p style={{ marginTop: 30, fontSize: 13, color: "#646970" }}>
            Thank you for creating with <a href="#" style={{ color: "#2271b1", textDecoration: "none" }}>WordPress</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #c3c4c7", boxShadow: "0 1px 1px rgba(0,0,0,.04)" }}>
      <h2
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#1d2327",
          margin: 0,
          padding: "8px 12px",
          borderBottom: "1px solid #c3c4c7",
        }}
      >
        {title}
      </h2>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function Glance({ label, n, icon }: { label: string; n: number; icon: string }) {
  return (
    <li style={{ padding: "4px 0" }}>
      <a href="#" style={{ color: "#2271b1", textDecoration: "none" }}>
        <span style={{ marginRight: 6 }}>{icon}</span>
        {n} {label}
      </a>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 400, color: "#1d2327", margin: "0 0 10px" }}>{title}</h2>
      {children}
    </div>
  );
}

function Table({
  head,
  rows,
  linkFirst,
}: {
  head: string[];
  rows: string[][];
  linkFirst?: boolean;
}) {
  const th: CSSProperties = {
    textAlign: "left",
    fontSize: 13,
    fontWeight: 600,
    color: "#2c3338",
    padding: "8px 10px",
    borderBottom: "1px solid #c3c4c7",
  };
  const td: CSSProperties = {
    fontSize: 13,
    color: "#50575e",
    padding: "8px 10px",
    borderBottom: "1px solid #f0f0f1",
    verticalAlign: "top",
  };
  return (
    <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #c3c4c7" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? "#f6f7f7" : "#fff" }}>
              {r.map((c, j) => (
                <td key={j} style={td}>
                  {linkFirst && j === 0 ? (
                    <a href="#" style={{ color: "#2271b1", textDecoration: "none", fontWeight: 600 }}>
                      {c}
                    </a>
                  ) : (
                    c
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Drupal ------------------------------ */

function DrupalAdmin({
  site,
  posts,
  users,
  comments,
}: {
  site: Site;
  posts: DataRow[];
  users: DataRow[];
  comments: DataRow[];
}) {
  const font = '"Lucida Grande", "Lucida Sans Unicode", "liberation sans", sans-serif';
  const tabs = ["Content", "Structure", "Appearance", "Extend", "Configuration", "People", "Reports"];
  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", fontFamily: font, color: "#43484c" }}>
      {/* Admin toolbar */}
      <div style={{ background: "#0d1214", color: "#fff", display: "flex", alignItems: "center", height: 40, padding: "0 16px", fontSize: 13 }}>
        <span style={{ fontWeight: 700, marginRight: 20 }}>{site.brand}</span>
        {tabs.map((t) => (
          <span key={t} style={{ marginRight: 18, color: t === "Content" ? "#fff" : "#b0b6bb" }}>
            {t}
          </span>
        ))}
        <span style={{ marginLeft: "auto", color: "#b0b6bb" }}>admin</span>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0d1214", margin: "0 0 6px" }}>Content</h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#0678be" }}>+ Add content</p>

        <DrupalTable
          head={["Title", "Content type", "Author", "Status", "Updated"]}
          rows={posts.map((p) => [
            s(p.payload.title, "Untitled"),
            "Article",
            s(p.payload.author, "admin"),
            s(p.payload.status, "Published"),
            s(p.payload.date, fmtDate(p.created_at)),
          ])}
        />

        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0d1214", margin: "40px 0 16px" }}>People</h1>
        <DrupalTable
          head={["Username", "Email", "Role", "Member for"]}
          rows={users.map((u) => [
            s(u.payload.username, "user"),
            s(u.payload.email, "—"),
            s(u.payload.role, "Authenticated user"),
            "3 months",
          ])}
        />

        {comments.length > 0 && (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0d1214", margin: "40px 0 16px" }}>Comments</h1>
            <DrupalTable
              head={["Author", "Comment", "Posted"]}
              rows={comments.map((c) => [
                s(c.payload.author, s(c.payload.name, "Anonymous")),
                s(c.payload.body, s(c.payload.text, "—")),
                fmtDate(c.created_at),
              ])}
            />
          </>
        )}
      </div>
    </div>
  );
}

function DrupalTable({ head, rows }: { head: string[]; rows: string[][] }) {
  const th: CSSProperties = {
    textAlign: "left",
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
    background: "#0678be",
    padding: "10px 12px",
  };
  const td: CSSProperties = {
    fontSize: 13,
    color: "#43484c",
    padding: "10px 12px",
    borderBottom: "1px solid #e6e6e6",
  };
  return (
    <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #d4d4d8", borderRadius: 3 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? "#f7fbfd" : "#fff" }}>
              {r.map((c, j) => (
                <td key={j} style={td}>
                  {j === 0 ? (
                    <a href="#" style={{ color: "#0678be", textDecoration: "none", fontWeight: 700 }}>
                      {c}
                    </a>
                  ) : (
                    c
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
