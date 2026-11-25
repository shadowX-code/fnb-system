"""Allow the browser to create a dedicated FeedX Auth session on this computer."""
import http.server
import json
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit


class AuthorizationError(Exception):
    pass


def authorize(key, origin, environment):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{10,550}", key) or not re.fullmatch(
        r"https://[a-z0-9]+\.supabase\.co", origin
    ) or environment not in ("Staging", "Production"):
        raise AuthorizationError("FeedX sign-in configuration is unavailable.")
    nonce = secrets.token_hex(32)
    authorize_path = "/authorize/" + nonce
    session_path = "/session/" + nonce
    bundle = Path(sys.executable).parents[1] / "Resources"
    source = bundle / "Setup-Authorization.html" if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1] / "print-bridge" / "Setup-Authorization.html"
    page = source.read_text().replace("__NONCE__", nonce).replace("__CLIENT_KEY__", key).replace(
        "__AUTH_ORIGIN__", origin
    ).replace("__ENVIRONMENT__", environment).encode("utf-8")
    session = None

    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(1.5)
            super().setup()

        def log_message(self, *_args):
            return

        def reply(self, status, body):
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; "
                f"script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; connect-src 'self' {origin}; "
                "frame-ancestors 'none'; form-action 'none'; base-uri 'none'")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == authorize_path and self.headers.get("Host") == host:
                self.reply(200, page)
            else:
                self.reply(404, b"Authorization not found.")

        def do_POST(self):
            nonlocal session
            length = self.headers.get("Content-Length", "")
            if (self.path != session_path or self.headers.get("Host") != host
                or self.headers.get("Origin") != url or self.headers.get("Content-Type") != "application/json"
                or self.headers.get("Transfer-Encoding") or not re.fullmatch(r"[0-9]{1,5}", length)
                or not 0 < int(length) <= 32768 or session is not None):
                self.reply(404, b"Authorization not found.")
                return
            try:
                payload = json.loads(self.rfile.read(int(length)))
                identity = payload["user"]["id"]
                expiry = int(payload["expires_in"])
                if not all(isinstance(payload[field], str) and payload[field] for field in ("access_token", "refresh_token")):
                    raise ValueError
                if not re.fullmatch(r"[0-9a-fA-F-]{36}", identity) or not 0 < expiry <= 86400:
                    raise ValueError
            except (ValueError, KeyError, TypeError):
                self.reply(400, b"Invalid authorization.")
                return
            session = dict(access_token=payload["access_token"], refresh_token=payload["refresh_token"],
                           user=identity, expires_at=int(time.time()) + expiry)
            self.reply(200, b"{}")

    with http.server.HTTPServer(("127.0.0.1", 0), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}"
        host = urlsplit(url).netloc
        server.timeout = 0.25
        subprocess.run(["/usr/bin/open", url + authorize_path], check=True)
        deadline = time.monotonic() + 180
        while session is None and time.monotonic() < deadline:
            server.handle_request()
    if session is None:
        raise AuthorizationError("Browser authorization expired. Try Authorize again.")
    return session
