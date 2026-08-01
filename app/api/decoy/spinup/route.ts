import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateFakeData } from "@/lib/fakedata";
import { launchDecoyVM } from "@/lib/modal";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const siteId: string | undefined = body.siteId;
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  const supabase = supabaseAdmin();

  // (a) load the site
  const { data: site, error: siteErr } = await supabase
    .from("honeypot_sites")
    .select("*")
    .eq("id", siteId)
    .single();

  if (siteErr || !site) {
    return NextResponse.json(
      { error: siteErr?.message || "site not found" },
      { status: 404 }
    );
  }

  // status -> arming while we build
  await supabase
    .from("honeypot_sites")
    .update({ status: "arming" })
    .eq("id", siteId);

  // (b) generate + insert fake data unless it already exists
  const { data: existing } = await supabase
    .from("honeypot_data")
    .select("id")
    .eq("site_id", siteId)
    .limit(1);

  let dataCount = 0;
  if (existing && existing.length > 0) {
    const { count } = await supabase
      .from("honeypot_data")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId);
    dataCount = count ?? 0;
  } else {
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
        if (!insErr) dataCount = toInsert.length;
      }
    } catch {
      // fake-data generation failed; still arm the site with an empty admin
      dataCount = 0;
    }
  }

  // (c) launch the "real VM" via Modal (may return null)
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

  // (d) mark active regardless (fallback is the in-app admin)
  await supabase
    .from("honeypot_sites")
    .update({ status: "active", vm_url: vmUrl })
    .eq("id", siteId);

  // (e) respond
  return NextResponse.json({
    url: vmUrl || "/decoy/" + siteId + "/admin",
    vmUrl,
    dataCount,
  });
}
