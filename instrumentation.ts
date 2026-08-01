// Keeps the email agent running without a cron: on server start, poll every 20s.
// Idle cost is just a Gmail list call until a GOOSE-subject email is unread.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.GG_POLL_LOOP === "off") return;

  const port = process.env.PORT || "3000";
  const base = `http://127.0.0.1:${port}`;
  const headers: Record<string, string> = process.env.CRON_SECRET
    ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
    : {};

  const tick = async () => {
    try {
      await fetch(`${base}/api/poll`, { headers });
    } catch {
      /* server may still be starting; ignore */
    }
  };

  // give the server a moment to start listening, then loop
  setTimeout(() => {
    tick();
    setInterval(tick, 20000);
  }, 8000);
}
