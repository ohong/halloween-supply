# Stand-in for the vision service: /healthz only, one JSON log line per request (same shape as the real service).
import json, platform, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        t = time.perf_counter()
        ok = self.path == "/healthz"
        body = json.dumps({"ok": True, "build": "placeholder", "arch": platform.machine()} if ok
                          else {"error": {"code": "not_found", "message": self.path}}).encode()
        self.send_response(200 if ok else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-OpenCV-Build", "none;placeholder")
        self.end_headers()
        self.wfile.write(body)
        print(json.dumps({"route": self.path, "status": 200 if ok else 404,
                          "ms": round((time.perf_counter() - t) * 1000, 2), "build": "placeholder"}), flush=True)

    def log_message(self, *a):
        pass

ThreadingHTTPServer(("0.0.0.0", 8080), H).serve_forever()
