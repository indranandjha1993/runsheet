import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createLogger, healthReport, type Logger, type Probe } from "@runsheet/runtime";
import type { HttpRequest } from "../adapters/http.js";

export interface ServerDeps {
  readonly router: {
    handle(
      request: HttpRequest,
    ): Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;
  };
  readonly probes: readonly Probe[];
  readonly logger: Logger;
  readonly port: number;
}

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
  headers: Record<string, string> = {},
): void {
  const contentType = headers["content-type"] ?? "application/json";
  response.writeHead(status, { ...headers, "content-type": contentType });

  // A file is already text. Serialising it again would hand the operator a quoted string in a
  // spreadsheet rather than the rows they asked for.
  response.end(contentType.startsWith("application/json") ? JSON.stringify(body) : String(body));
}

export function createHttpServer(deps: ServerDeps): ReturnType<typeof createServer> {
  return createServer((incoming, outgoing) => {
    void (async () => {
      const url = incoming.url ?? "/";
      if (url.startsWith("/health")) {
        const report = await healthReport([...deps.probes]);
        send(outgoing, report.status === "ready" ? 200 : 503, report);
        return;
      }

      const started = Date.now();
      const response = await deps.router.handle({
        method: incoming.method ?? "GET",
        url,
        headers: incoming.headers as Record<string, string | undefined>,
        body: await readBody(incoming),
      });

      deps.logger.info("request", {
        method: incoming.method,
        path: url.split("?")[0],
        status: response.status,
        durationMs: Date.now() - started,
      });
      send(outgoing, response.status, response.body, response.headers);
    })();
  });
}

export function serviceLogger(service: string, level: string): Logger {
  return createLogger({ service, level: level as "debug" | "info" | "warn" | "error" });
}
