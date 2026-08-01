// Bridge to the Modal "real VM" honeypot. If MODAL_HONEYPOT_URL points at a
// deployed Modal web endpoint (see modal/honeypot_app.py), we POST the site +
// fake data and it spins up a live sandbox serving a fake wp-admin, returning
// its public URL. If the env var is missing or the call fails, return null and
// the Next app falls back to the in-app /decoy/[id]/admin page.
export async function launchDecoyVM(
  site: any,
  data: any[]
): Promise<string | null> {
  const endpoint = process.env.MODAL_HONEYPOT_URL;
  if (!endpoint) return null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, data }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.url === "string" ? json.url : null;
  } catch {
    return null;
  }
}
