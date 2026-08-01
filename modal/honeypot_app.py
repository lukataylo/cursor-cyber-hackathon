# Honeypot "real VM" path (defensive deception tech).
#
# Deploy:
#   pip install modal
#   modal token new                      # or set MODAL_TOKEN_ID / MODAL_TOKEN_SECRET
#   modal deploy modal/honeypot_app.py
#
# After deploy, Modal prints the web endpoint URL for `spawn_honeypot`. Put it in
# the Next app's env as MODAL_HONEYPOT_URL. When the Next /api/decoy/spinup route
# fires, it POSTs {site, data} JSON here; this endpoint launches a modal.Sandbox
# running a tiny HTTP server that serves a fake wp-admin populated with that data,
# and returns {"url": "<public sandbox url>"}.
#
# Requires MODAL_TOKEN_ID and MODAL_TOKEN_SECRET (from `modal token new`).
# If these creds are absent the Next app never calls this file and instead falls
# back to its in-app /decoy/[id]/admin page, so the demo works without Modal.

import json

import modal

app = modal.App("honeypot-decoy")

# Image for the endpoint itself (needs fastapi to receive the request).
web_image = modal.Image.debian_slim().pip_install("fastapi[standard]")

# Image the sandbox boots from. Python stdlib http.server is enough for a
# convincing static fake admin, so keep it minimal.
sandbox_image = modal.Image.debian_slim()

# The server script that runs INSIDE the sandbox. It reads the injected site/data
# JSON from /root/payload.json and renders a fake wp-admin dashboard.
SERVER_SCRIPT = r'''
import json, html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    with open("/root/payload.json") as f:
        PAYLOAD = json.load(f)
except Exception:
    PAYLOAD = {"site": {}, "data": []}

SITE = PAYLOAD.get("site", {}) or {}
ROWS = PAYLOAD.get("data", []) or []
BRAND = SITE.get("brand", "My Store")


def rows_of(kind):
    return [r.get("payload", {}) for r in ROWS if r.get("kind") == kind]


def table(title, cols, items):
    if not items:
        return ""
    head = "".join("<th style='text-align:left;padding:8px 12px;border-bottom:2px solid #c3c4c7'>%s</th>" % html.escape(c.title()) for c in cols)
    body = ""
    for it in items:
        cells = "".join(
            "<td style='padding:8px 12px;border-bottom:1px solid #e0e0e0'>%s</td>" % html.escape(str(it.get(c, "")))
            for c in cols
        )
        body += "<tr>%s</tr>" % cells
    return (
        "<h2 style='font-size:16px;margin:24px 0 8px'>%s</h2>"
        "<table style='border-collapse:collapse;width:100%%;background:#fff;box-shadow:0 1px 1px rgba(0,0,0,.04)'>"
        "<thead><tr>%s</tr></thead><tbody>%s</tbody></table>"
    ) % (html.escape(title), head, body)


def dashboard():
    parts = [
        table("Users", ["username", "email", "role"], rows_of("user")),
        table("Posts", ["title", "author", "date", "status"], rows_of("post")),
        table("WooCommerce Orders", ["number", "customer", "total", "status"], rows_of("order")),
        table("Customers", ["name", "email", "orders"], rows_of("customer")),
        table("Plugins", ["name", "version", "active"], rows_of("plugin")),
    ]
    return """<!doctype html><html><head><meta charset=utf-8>
<title>%s &lsaquo; WordPress</title></head>
<body style='margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f0f0f1;color:#3c434a'>
<div style='background:#1d2327;color:#fff;padding:10px 16px;font-size:13px'>&#127968; %s &nbsp;&mdash;&nbsp; WordPress Admin</div>
<div style='display:flex'>
  <nav style='width:160px;background:#1d2327;color:#f0f0f1;min-height:100vh;padding:12px 0;font-size:14px'>
    %s
  </nav>
  <main style='flex:1;padding:20px 28px'>
    <h1 style='font-size:23px;font-weight:400'>Dashboard</h1>
    %s
  </main>
</div></body></html>""" % (
        html.escape(BRAND),
        html.escape(BRAND),
        "".join("<div style='padding:8px 16px'>%s</div>" % x for x in ["Dashboard", "Posts", "Media", "Pages", "WooCommerce", "Users", "Plugins", "Settings"]),
        "".join(parts),
    )


LOGIN = """<!doctype html><html><head><meta charset=utf-8><title>Log In &lsaquo; %s</title></head>
<body style='background:#f0f0f1;font-family:-apple-system,Segoe UI,Roboto,sans-serif'>
<div style='width:320px;margin:8%% auto;background:#fff;padding:26px 24px;box-shadow:0 1px 3px rgba(0,0,0,.13)'>
<h1 style='text-align:center;font-size:20px'>%s</h1>
<form method='post' action='/wp-login.php'>
<p><label>Username or Email<br><input name='log' style='width:100%%;padding:8px;margin-top:4px'></label></p>
<p><label>Password<br><input name='pwd' type='password' style='width:100%%;padding:8px;margin-top:4px'></label></p>
<p><button style='background:#2271b1;color:#fff;border:0;padding:8px 16px;width:100%%'>Log In</button></p>
</form></div></body></html>""" % (html.escape(BRAND), html.escape(BRAND))


class H(BaseHTTPRequestHandler):
    def _send(self, body, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def do_GET(self):
        if self.path.startswith("/wp-login.php") or self.path in ("/", "/wp-admin", "/wp-admin/"):
            # NB: a real deployment logs the attacker's IP / UA here.
            self._send(LOGIN if self.path.startswith("/wp-login") else dashboard())
        elif self.path.startswith("/wp-admin"):
            self._send(dashboard())
        else:
            self._send(LOGIN)

    def do_POST(self):
        # Accept any credentials, then "log in" to the fake dashboard.
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length:
            self.rfile.read(length)
        self._send(dashboard())

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("0.0.0.0", 8080), H).serve_forever()
'''


@app.function(image=web_image)
@modal.fastapi_endpoint(method="POST")
def spawn_honeypot(payload: dict):
    """Receive {site, data}, boot a sandbox serving a fake wp-admin, return its URL."""
    site = payload.get("site", {})
    data = payload.get("data", [])

    # Inject the payload + server script into the sandbox via a heredoc, then run.
    injected = json.dumps({"site": site, "data": data})

    sb = modal.Sandbox.create(
        "bash",
        "-c",
        # Persist payload + server, then run the stdlib HTTP server on 8080.
        "cat > /root/payload.json <<'PAYLOAD_EOF'\n"
        + injected
        + "\nPAYLOAD_EOF\n"
        + "cat > /root/server.py <<'SERVER_EOF'\n"
        + SERVER_SCRIPT
        + "\nSERVER_EOF\n"
        + "python3 /root/server.py",
        image=sandbox_image,
        encrypted_ports=[8080],
        timeout=60 * 60,  # keep the honeypot alive for up to an hour
        app=app,
    )

    tunnel = sb.tunnels()[8080]
    return {"url": tunnel.url}
