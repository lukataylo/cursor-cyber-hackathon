import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateFakeData } from "@/lib/fakedata";
import { launchDecoyVM } from "@/lib/modal";

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const siteId = typeof body?.siteId === "string" ? body.siteId : undefined;
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }
  if (!UUID_RE.test(siteId)) {
    return NextResponse.json({ error: "invalid siteId" }, { status: 400 });
  }

  const supabase = supabaseAdmin();

  // (a) load the site (need brand/template to generate on-brand data)
  const { data: site, error: siteErr } = await supabase
    .from("honeypot_sites")
    .select("*")
    .eq("id", siteId)
    .maybeSingle();

  if (siteErr) {
    console.error("[spinup] load site failed:", siteErr);
    return NextResponse.json({ error: "spinup failed" }, { status: 500 });
  }
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  const countData = async () => {
    const { count } = await supabase
      .from("honeypot_data")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId);
    return count ?? 0;
  };

  // (b) Atomically claim the site so only ONE concurrent caller generates data.
  // The status column is constrained to holding/arming/active, so we use the
  // move out of the claimable set (holding|arming -> active) as the claim: the
  // first UPDATE flips the row, and any concurrent UPDATE then fails its WHERE
  // (status no longer in holding|arming) and affects zero rows. Only the winner
  // gets a row back from .select(), so only the winner generates.
  const { data: claimed, error: claimErr } = await supabase
    .from("honeypot_sites")
    .update({ status: "active" })
    .eq("id", siteId)
    .in("status", ["holding", "arming"])
    .select("id");

  if (claimErr) {
    console.error("[spinup] claim failed:", claimErr);
    return NextResponse.json({ error: "spinup failed" }, { status: 500 });
  }

  const wonClaim = Array.isArray(claimed) && claimed.length > 0;

  // Loser (or a site that was already active): do NOT regenerate. Return the
  // count of whatever data already exists so honeypot_data is never duplicated.
  if (!wonClaim) {
    const dataCount = await countData();
    return NextResponse.json({
      url: site.vm_url || "/decoy/" + siteId + "/admin",
      vmUrl: site.vm_url ?? null,
      dataCount,
    });
  }

  // (c) Winner: generate + insert fake data exactly once. Guard against any
  // pre-existing rows as an extra idempotency belt-and-suspenders.
  let dataCount = await countData();
  if (dataCount === 0) {
    try {
      const rows = await generateFakeData(site.brand, site.template);
      const toInsert = rows.map((r) => ({
        site_id: siteId,
        kind: r.kind,
        payload: r.payload,
      }));
      if (toInsert.length) {
        const { error: insErr } = await supabase
          .from("honeypot_data")
          .insert(toInsert);
        if (insErr) {
          console.error("[spinup] insert fake data failed:", insErr);
        } else {
          dataCount = toInsert.length;
        }
      }
    } catch (e) {
      // fake-data generation failed; still arm the site with an empty admin
      console.error("[spinup] generateFakeData failed:", e);
      dataCount = 0;
    }
  }

  // (d) launch the "real VM" via Modal (may return null)
  let vmUrl: string | null = null;
  try {
    const { data: allData } = await supabase
      .from("honeypot_data")
      .select("kind,payload")
      .eq("site_id", siteId);
    vmUrl = await launchDecoyVM(site, allData ?? []);
  } catch {
    vmUrl = null;
  }

  // (e) persist the VM url (status is already 'active' from the claim)
  await supabase
    .from("honeypot_sites")
    .update({ status: "active", vm_url: vmUrl })
    .eq("id", siteId);

  // (f) respond
  return NextResponse.json({
    url: vmUrl || "/decoy/" + siteId + "/admin",
    vmUrl,
    dataCount,
  });
}
