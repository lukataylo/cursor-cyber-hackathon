// Scrape a target site's public branding so a decoy can mimic the real company.
// Pulls brand name, icon/logo, accent colour, and detects the CMS. Best-effort:
// every failure degrades to a sensible fallback, never throws.

export type BrandKit = {
  brand: string;
  logoUrl: string | null;
  accent: string | null;
  cms: "wordpress" | "drupal" | null;
  finalUrl: string;
};

function normalize(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
function hostBrand(url: string) {
  try {
    const core = new URL(url).hostname.replace(/^www\./, "").split(".")[0] || "";
    return core.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  } catch {
    return "Acme";
  }
}
function cleanTitle(t: string) {
  return t.split(/[|\-–—:]/)[0].trim().slice(0, 60);
}
function abs(href: string, base: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export async function scrapeBrand(rawUrl: string): Promise<BrandKit> {
  let base = normalize(rawUrl);
  let html = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(base, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36", accept: "text/html" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    base = res.url || base;
    html = await res.text();
  } catch {
    // no HTML — fall back to host-derived brand + guessed favicon
    return { brand: hostBrand(base), logoUrl: abs("/favicon.ico", base), accent: null, cms: null, finalUrl: base };
  }

  const pick = (re: RegExp) => html.match(re)?.[1]?.trim() ?? "";
  const meta = (name: string) =>
    pick(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")) ||
    pick(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"));

  const brand = meta("og:site_name") || meta("application-name") || cleanTitle(pick(/<title[^>]*>([^<]+)<\/title>/i)) || hostBrand(base);
  const accent = meta("theme-color") || null;
  const iconHref =
    pick(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
    pick(/<link[^>]+rel=["'][^"']*(?:shortcut )?icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
    meta("og:image");
  const logoUrl = iconHref ? abs(iconHref, base) : abs("/favicon.ico", base);
  const cms: BrandKit["cms"] = /wp-content|wp-json|generator["'][^>]*WordPress/i.test(html)
    ? "wordpress"
    : /Drupal\.settings|sites\/default\/files|generator["'][^>]*Drupal/i.test(html)
    ? "drupal"
    : null;

  return { brand, logoUrl, accent, cms, finalUrl: base };
}
