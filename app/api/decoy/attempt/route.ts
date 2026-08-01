import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An attacker just submitted credentials to a decoy login page.
// Log the attempt, arm the honeypot on first contact, and "let them in" after they persist.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const siteId = typeof body?.siteId === "string" ? body.siteId : undefined;
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }
  if (!UUID_RE.test(siteId)) {
    return NextResponse.json({ error: "invalid siteId" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const user_agent = req.headers.get("user-agent") || "unknown";

  const db = supabaseAdmin();

  // Validate the site actually exists before recording anything against it.
  const { data: site, error: siteErr } = await db
    .from("honeypot_sites")
    .select("id,status")
    .eq("id", siteId)
    .maybeSingle();

  if (siteErr) {
    console.error("[attempt] site lookup failed:", siteErr);
    return NextResponse.json({ error: "attempt failed" }, { status: 500 });
  }
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  // Record the harvested credentials.
  const { error: insErr } = await db.from("honeypot_attempts").insert({
    site_id: siteId,
    username,
    password,
    ip,
    user_agent,
  });
  if (insErr) {
    console.error("[attempt] insert failed:", insErr);
    return NextResponse.json({ error: "attempt failed" }, { status: 500 });
  }

  // How many credential attempts have hit this site so far?
  const { count } = await db
    .from("honeypot_attempts")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId);
  const attempts = count ?? 1;

  // On first contact, arm the decoy and fire off the (async) spinup of the fake admin.
  if (attempts === 1) {
    if (site.status === "holding") {
      await db
        .from("honeypot_sites")
        .update({ status: "arming" })
        .eq("id", siteId);

      // Fire-and-forget: kick off admin spinup without blocking the response.
      fetch(new URL("/api/decoy/spinup", req.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId }),
      }).catch(() => {});
    }
  }

  // Keep them trying on the first attempt; let them "in" once they persist.
  if (attempts <= 1) {
    return NextResponse.json({ status: "invalid" });
  }
  return NextResponse.json({
    status: "redirect",
    adminUrl: `/decoy/${siteId}/admin`,
  });
}
