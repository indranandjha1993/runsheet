import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createLogger, healthReport, type Probe } from "@runsheet/runtime";
import { createProxy } from "./application/proxy.js";
import { UPSTREAMS } from "./domain/routing-table.js";
import { addressOf, describeConfig, gatewayConfig } from "./infra/config.js";

const config = gatewayConfig();
const logger = createLogger({ service: "gateway", level: config.LOG_LEVEL });

const proxy = createProxy({
  addressOf: (upstream) => addressOf(config, upstream.name),
  perMinute: config.RATE_LIMIT_PER_MINUTE,
  logger,
});

// Every service must answer before the gateway calls itself ready, so a load balancer never
// sends traffic at a system that cannot serve it.
const probes: Probe[] = [...new Set(UPSTREAMS.map((upstream) => upstream.name))].map((name) => ({
  name,
  check: async () => {
    const address = addressOf(config, name);
    if (address === undefined) throw new Error("no address configured");
    const response = await fetch(`${address}/health`);
    if (!response.ok) throw new Error(`answered ${String(response.status)}`);
  },
}));

async function readBody(incoming: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string>,
): void {
  const contentType = headers["content-type"] ?? "application/json";
  response.writeHead(status, { ...headers, "content-type": contentType });
  response.end(contentType.startsWith("application/json") ? JSON.stringify(body) : String(body));
}

const server = createServer((incoming, outgoing) => {
  void (async () => {
    const url = incoming.url ?? "/";
    if (url.startsWith("/health")) {
      const report = await healthReport(probes);
      send(outgoing, report.status === "ready" ? 200 : 503, report, {});
      return;
    }

    const started = Date.now();
    const response = await proxy.handle({
      method: incoming.method ?? "GET",
      url,
      headers: incoming.headers as Record<string, string | undefined>,
      body: await readBody(incoming),
    });

    logger.info("request", {
      method: incoming.method,
      path: url.split("?")[0],
      status: response.status,
      durationMs: Date.now() - started,
    });
    send(outgoing, response.status, response.body, response.headers);
  })();
});

server.listen(config.PORT_GATEWAY, () => {
  logger.info("gateway listening", describeConfig(config));
});
