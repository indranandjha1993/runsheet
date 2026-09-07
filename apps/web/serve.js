// Serves the built app and forwards platform calls to the gateway, so one process on one port is
// the whole interface. Locally run-all.sh starts it; in a deployment any static host will do.
import { createServer, request as forward } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";

const dist = new URL("./dist/", import.meta.url).pathname;
const port = Number(process.env["PORT_WEB"] ?? 14100);
const gateway = new URL(process.env["GATEWAY_URL"] ?? "http://localhost:14000");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

createServer((incoming, outgoing) => {
  const path = new URL(incoming.url ?? "/", "http://local").pathname;
  if (path.startsWith("/v1/") || path.startsWith("/track/") || path === "/health") {
    const upstream = forward(
      { host: gateway.hostname, port: gateway.port, path: incoming.url, method: incoming.method, headers: incoming.headers },
      (reply) => {
        outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.writeHead(502, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: { code: "upstream_unavailable", message: "the gateway did not respond" } }));
    });
    incoming.pipe(upstream);
    return;
  }
  const file = join(dist, path === "/" ? "index.html" : path);
  const served = existsSync(file) && !file.endsWith("/") ? file : join(dist, "index.html");
  outgoing.writeHead(200, { "content-type": types[extname(served)] ?? "application/octet-stream" });
  outgoing.end(readFileSync(served));
}).listen(port, () => {
  process.stdout.write(`web listening on ${String(port)}, gateway ${gateway.href}\n`);
});
