import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { scrapeBrand } from "@/lib/scrape";

export const maxDuration = 60;

const MODEL = anthropic("claude-sonnet-5");

// Derive a readable brand from a URL host, e.g. https://shop.acme-tools.co.uk -> "Acme Tools".
function brandFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const core = host.split(".")[0];
    if (!core) return null;
    return core
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let template: "wordpress" | "drupal" =
    body.template === "drupal" ? "drupal" : "wordpress";
  const mimic_url: string | undefined = body.mimic_url;

  let brand: string | undefined = body.brand?.trim() || undefined;
  let logo_url: string | null = null;
  let accent: string | null = null;

  // Scrape the real target so the decoy mimics its brand, icon, colour, and CMS.
  if (mimic_url) {
    const kit = await scrapeBrand(mimic_url);
    if (!brand) brand = kit.brand;
    logo_url = kit.logoUrl;
    accent = kit.accent;
    if (kit.cms && !body.template) template = kit.cms; // prefer the detected CMS
  }

  if (!brand) brand = brandFromUrl(mimic_url) || undefined;
  if (!brand) {
    try {
      const { text } = await generateText({
        model: MODEL,
        system:
          "Invent a short, believable business/brand name (2-3 words, no quotes, " +
          "no punctuation, no explanation). Output only the name.",
        prompt: mimic_url
          ? `Suggest a brand for a site like: ${mimic_url}`
          : "Suggest a brand for a small online retailer.",
      });
      brand = text.trim().split("\n")[0].slice(0, 60) || undefined;
    } catch {
      brand = "Northgate Supply Co";
    }
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("honeypot_sites")
    .insert({
      template,
      brand,
      mimic_url: mimic_url ?? null,
      status: "holding",
      logo_url,
      accent,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[site] insert failed:", error);
    return NextResponse.json({ error: "could not create decoy" }, { status: 500 });
  }

  return NextResponse.json({
    siteId: data.id,
    url: "/decoy/" + data.id,
    template,
    brand,
  });
}
