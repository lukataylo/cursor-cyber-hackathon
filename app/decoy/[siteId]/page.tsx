import { supabaseAdmin } from "@/lib/supabase";
import DecoyLogin from "./DecoyLogin";

type Site = {
  id: string;
  template: "wordpress" | "drupal";
  brand: string;
  mimic_url: string | null;
  status: string;
  logo_url: string | null;
  accent: string | null;
};

export default async function DecoyPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const db = supabaseAdmin();
  const { data } = await db
    .from("honeypot_sites")
    .select("id, template, brand, mimic_url, status, logo_url, accent")
    .eq("id", siteId)
    .maybeSingle();

  const site = data as Site | null;
  if (!site) return <NotFound />;

  return site.template === "drupal" ? (
    <DrupalLogin site={site} />
  ) : (
    <WordPressLogin site={site} />
  );
}

function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fff",
        color: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 500, padding: 24 }}>
        <h1 style={{ fontSize: 48, margin: "0 0 8px", fontWeight: 600 }}>404</h1>
        <p style={{ fontSize: 16, color: "#444" }}>
          This page could not be found.
        </p>
      </div>
    </div>
  );
}

function WordPressLogin({ site }: { site: Site }) {
  const initial = (site.brand || "W").trim().charAt(0).toUpperCase() || "W";
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f0f0f1",
        color: "#3c434a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "8%",
        boxSizing: "border-box",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif',
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <h1 style={{ margin: "0 0 25px" }}>
        <a
          href="#"
          aria-label={site.brand}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textDecoration: "none",
            color: "#3c434a",
          }}
        >
          {site.logo_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={site.logo_url}
              alt={site.brand}
              width={84}
              height={84}
              style={{ width: 84, height: 84, objectFit: "contain", borderRadius: 12 }}
            />
          ) : (
            <span
              style={{
                width: 84,
                height: 84,
                borderRadius: "50%",
                background: "#3c434a",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 44,
                fontWeight: 300,
                fontFamily: "Georgia, serif",
              }}
            >
              {initial}
            </span>
          )}
          <span style={{ marginTop: 12, fontSize: 20, fontWeight: 400 }}>
            {site.brand}
          </span>
        </a>
      </h1>
      <div
        style={{
          background: "#fff",
          border: "1px solid #c3c4c7",
          boxShadow: "0 1px 3px rgba(0,0,0,.04)",
          padding: "26px 24px 34px",
          width: 320,
          boxSizing: "border-box",
          borderRadius: 0,
        }}
      >
        <DecoyLogin siteId={site.id} template="wordpress" brand={site.brand} accent={site.accent || "#2271b1"} />
      </div>
      <p style={{ margin: "16px 0 2px", fontSize: 13 }}>
        <a href="#" style={{ color: "#50575e", textDecoration: "none" }}>
          Lost your password?
        </a>
      </p>
      <p style={{ margin: "16px 0", fontSize: 13 }}>
        <a
          href={site.mimic_url || "#"}
          style={{ color: "#50575e", textDecoration: "none" }}
        >
          ← Go to {site.brand}
        </a>
      </p>
    </div>
  );
}

function DrupalLogin({ site }: { site: Site }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fff",
        color: "#43484c",
        fontFamily:
          '"Lucida Grande", "Lucida Sans Unicode", "liberation sans", sans-serif',
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          borderTop: `5px solid ${site.accent || "#0678be"}`,
          background: "#0d1214",
          color: "#fff",
          padding: "14px 24px",
          fontSize: 20,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {site.logo_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={site.logo_url} alt="" width={24} height={24} style={{ width: 24, height: 24, objectFit: "contain" }} />
        )}
        {site.brand}
      </div>
      <div
        style={{
          maxWidth: 460,
          margin: "48px auto",
          padding: "0 20px",
        }}
      >
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 8px", color: "#0d1214" }}>
          Log in
        </h1>
        <div
          style={{
            background: "#fff",
            border: "1px solid #d4d4d8",
            borderRadius: 4,
            padding: "28px 26px",
            marginTop: 20,
            boxShadow: "0 1px 2px rgba(0,0,0,.05)",
          }}
        >
          <DecoyLogin siteId={site.id} template="drupal" brand={site.brand} accent={site.accent || "#0678be"} />
          <p style={{ margin: "20px 0 0", fontSize: 13 }}>
            <a href="#" style={{ color: "#0678be", textDecoration: "none" }}>
              Reset your password
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
