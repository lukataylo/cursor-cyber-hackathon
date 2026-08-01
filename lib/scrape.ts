// Scrape a target site's public branding so a decoy can mimic the real company.
// Pulls brand name, icon/logo, accent colour, and detects the CMS. Best-effort:
// every failure degrades to a sensible fallback, never throws.
//
// Because this fetches a user-supplied URL on the server, it is a classic SSRF
// sink. Every outbound request is gated by an allow-check that resolves the
// host and rejects loopback / private / link-local / cloud-metadata targets,
// and redirects are followed manually so each hop is re-checked.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

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
    return (
      core
        .split(/[-_]/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" ") || "Acme"
    );
  } catch {
    return "Acme";
  }
}
function cleanTitle(t: string) {
  return t
    .replace(/\s+/g, " ")
    .split(/[|\-–—:•·]/)[0]
    .trim()
    .slice(0, 60);
}
function abs(href: string, base: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed -> treat as unsafe
  }
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // loopback 127./8
  if (a === 10) return true; // private 10./8
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16-31
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function ipIsPrivate(raw: string): boolean {
  let ip = raw.toLowerCase().split("%")[0]; // drop zone id
  ip = ip.replace(/^\[|\]$/g, ""); // drop ipv6 brackets
  // IPv4-mapped / -compatible IPv6, e.g. ::ffff:127.0.0.1
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);
  if (isIP(ip) === 4) return ipv4IsPrivate(ip);
  if (isIP(ip) === 6) {
    if (ip === "::1" || ip === "::") return true; // loopback / unspecified
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local fc00::/7
    if (ip.startsWith("fe80") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb"))
      return true; // link-local fe80::/10
    if (ip.startsWith("ff")) return true; // multicast
    return false;
  }
  return true; // not a recognisable IP -> unsafe
}

// Returns true only when the URL is safe to fetch server-side.
async function isSafeUrl(u: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host) return false;

  // Named metadata / loopback hosts.
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "metadata.google.internal" || host.endsWith(".metadata.google.internal"))
    return false;
  if (host === "metadata" || host === "instance-data") return false;

  // Literal IP hosts.
  if (isIP(host)) return !ipIsPrivate(host);

  // Resolve DNS and reject if ANY resolved address is private (defends DNS rebinding).
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length) return false;
    return addrs.every((a) => !ipIsPrivate(a.address));
  } catch {
    return false; // unresolvable -> unreachable/unsafe
  }
}

// Fetch that manually follows redirects, re-checking SSRF safety on every hop.
// Returns null if blocked or on any network error.
async function safeFetch(
  start: string,
  opts: { method?: string; timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<{ res: Response; finalUrl: string } | null> {
  const { method = "GET", timeoutMs = 8000, headers = {} } = opts;
  let current = start;
  for (let hop = 0; hop < 5; hop++) {
    if (!(await isSafeUrl(current))) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        method,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5",
          ...headers,
        },
        signal: ctrl.signal,
        redirect: "manual",
      });
    } catch {
      clearTimeout(timer);
      return null;
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: current };
      const next = abs(loc, current);
      if (!next) return { res, finalUrl: current };
      current = next;
      continue;
    }
    return { res, finalUrl: res.url || current };
  }
  return null; // too many redirects
}

// ---------------------------------------------------------------------------
// Logo verification
// ---------------------------------------------------------------------------

async function isReachableImage(url: string): Promise<boolean> {
  // Try HEAD first (cheap); many CDNs reject HEAD, so fall back to a ranged GET.
  for (const method of ["HEAD", "GET"] as const) {
    const out = await safeFetch(url, { method, timeoutMs: 6000 });
    if (!out) continue;
    const { res } = out;
    if (!res.ok) {
      if (method === "GET") return false;
      continue; // HEAD may be unsupported -> try GET
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("image/")) return true;
    // .ico is often served with an odd/empty content-type.
    if (!ct && /\.(ico|png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) return true;
    if (method === "GET") return false;
  }
  return false;
}

// Find an <img> whose attributes look like a brand logo, preferring the header.
function findLogoImg(html: string): string {
  const header =
    html.match(/<header[^>]*>[\s\S]{0,6000}?<\/header>/i)?.[0] ||
    html.match(/<[^>]+(?:role=["']banner["']|id=["'][^"']*header[^"']*["'])[^>]*>[\s\S]{0,4000}/i)?.[0] ||
    "";
  for (const scope of [header, html]) {
    if (!scope) continue;
    const imgs = scope.match(/<img\b[^>]*>/gi) || [];
    for (const tag of imgs) {
      if (!/logo|brand/i.test(tag)) continue;
      const src =
        tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ||
        tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ||
        tag.match(/\bsrcset=["']([^"'\s,]+)/i)?.[1];
      if (src && !/^data:/i.test(src)) return src;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scrapeBrand(rawUrl: string): Promise<BrandKit> {
  let base = normalize(rawUrl);

  // SSRF gate: if the target is not safe to reach, skip the fetch entirely and
  // return a host-derived brand.
  if (!(await isSafeUrl(base))) {
    return { brand: hostBrand(base), logoUrl: null, accent: null, cms: null, finalUrl: base };
  }

  let html = "";
  const fetched = await safeFetch(base, { headers: { accept: "text/html,application/xhtml+xml" } });
  if (!fetched) {
    // Unreachable / blocked redirect / network error -> host-derived fallback.
    return { brand: hostBrand(base), logoUrl: null, accent: null, cms: null, finalUrl: base };
  }
  base = fetched.finalUrl || base;
  try {
    html = await fetched.res.text();
  } catch {
    return { brand: hostBrand(base), logoUrl: null, accent: null, cms: null, finalUrl: base };
  }

  const pick = (re: RegExp) => html.match(re)?.[1]?.trim() ?? "";
  const meta = (name: string) =>
    pick(
      new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*\\bcontent=["']([^"']+)["']`, "i")
    ) ||
    pick(
      new RegExp(`<meta[^>]+\\bcontent=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, "i")
    );

  const brand =
    meta("og:site_name") ||
    meta("application-name") ||
    meta("twitter:title") ||
    cleanTitle(pick(/<title[^>]*>([\s\S]*?)<\/title>/i)) ||
    hostBrand(base);

  const accent =
    meta("theme-color") ||
    pick(/<meta[^>]+name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i) ||
    null;

  // Logo candidates, in order of preference. Each relative href is resolved
  // against the final URL, then verified as a reachable image below.
  const candidates: string[] = [];
  const add = (href: string) => {
    if (!href || /^data:/i.test(href)) return;
    const a = abs(href, base);
    if (a && !candidates.includes(a)) candidates.push(a);
  };

  add(pick(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i));
  add(pick(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*apple-touch-icon[^"']*["']/i));
  add(pick(/<link[^>]+rel=["'][^"']*(?:shortcut )?icon[^"']*["'][^>]*href=["']([^"']+)["']/i));
  add(pick(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*(?:shortcut )?icon[^"']*["']/i));
  add(findLogoImg(html));
  add(meta("og:image"));
  add(meta("twitter:image"));
  add("/favicon.ico");

  // Prefer the first candidate that actually resolves to an image.
  let logoUrl: string | null = null;
  for (const c of candidates) {
    if (await isReachableImage(c)) {
      logoUrl = c;
      break;
    }
  }
  // Best-effort fallback: if none verified, still hand back the best guess so the
  // clone has something to render.
  if (!logoUrl) logoUrl = candidates[0] ?? abs("/favicon.ico", base);

  const cms: BrandKit["cms"] = /wp-content|wp-json|wp-includes|generator["'][^>]*WordPress/i.test(
    html
  )
    ? "wordpress"
    : /Drupal\.settings|sites\/default\/files|data-drupal|generator["'][^>]*Drupal/i.test(html)
    ? "drupal"
    : null;

  return { brand: brand || hostBrand(base), logoUrl, accent, cms, finalUrl: base };
}
