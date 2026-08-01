import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

// An attacker just submitted credentials to a decoy login page.
// Log the attempt, arm the honeypot on first contact, and "let them in" after they persist.
export async function POST(req: NextRequest) {
  const { siteId, username, password } = await req.json();
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const user_agent = req.headers.get("user-agent") || "unknown";

  const db = supabaseAdmin();

  // Record the harvested credentials.
  await db.from("honeypot_attempts").insert({
    site_id: siteId,
    username: username ?? "",
    password: password ?? "",
    ip,
    user_agent,
  });

  // How many credential attempts have hit this site so far?
  const { count } = await db
    .from("honeypot_attempts")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId);
  const attempts = count ?? 1;

  // On first contact, arm the decoy and fire off the (async) spinup of the fake admin.
  if (attempts === 1) {
    const { data: site } = await db
      .from("honeypot_sites")
      .select("status")
      .eq("id", siteId)
      .maybeSingle();

    if (site?.status === "holding") {
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
