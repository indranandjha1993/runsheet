import { newTraceContext, toTraceparent, type Logger } from "@runsheet/runtime";
import { upstreamFor, type Upstream } from "../domain/routing-table.js";
import { rateLimiter, type Decision } from "../domain/rate-limit.js";

export interface GatewayRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | undefined>;
  readonly body: unknown;
}

export interface GatewayResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

export interface ProxyOptions {
  readonly addressOf: (upstream: Upstream) => string | undefined;
  readonly perMinute: number;
  readonly logger: Logger;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

function fail(status: number, code: string, message: string): Omit<GatewayResponse, "headers"> {
  return { status, body: { error: { code, message } } };
}

// A caller is identified by their credential, never by their address. Two customers behind one
// company network must not share an allowance, and one caller must not escape theirs by moving.
function callerKey(headers: Record<string, string | undefined>): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "authorization" && value !== undefined) return value;
  }
  return "anonymous";
}

function allowanceHeaders(
  perMinute: number,
  limit: Decision,
  traceparent: string,
): Record<string, string> {
  return {
    traceparent,
    "ratelimit-limit": String(perMinute),
    "ratelimit-remaining": String(limit.remaining),
  };
}

interface Attempt {
  readonly request: GatewayRequest;
  readonly traceparent: string;
  readonly limitHeaders: Record<string, string>;
  readonly upstream: Upstream;
}

function refusedFor(
  attempt: Attempt,
  limit: Decision,
  addressed: string | undefined,
): GatewayResponse | undefined {
  if (!limit.allowed) {
    return {
      ...fail(429, "too_many_requests", "slow down and try again shortly"),
      headers: { ...attempt.limitHeaders, "retry-after": String(limit.retryAfterSeconds) },
    };
  }
  if (addressed === undefined) {
    return {
      ...fail(503, "service_unavailable", `${attempt.upstream.name} is not configured`),
      headers: attempt.limitHeaders,
    };
  }
  return undefined;
}

export function createProxy(options: ProxyOptions): {
  handle(request: GatewayRequest): Promise<GatewayResponse>;
} {
  const limiter = rateLimiter({
    perMinute: options.perMinute,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const call = options.fetch ?? globalThis.fetch;

  return {
    async handle(request) {
      const trace = newTraceContext(request.headers["traceparent"]);
      const traceparent = toTraceparent(trace);
      const path = new URL(request.url, "http://gateway.local").pathname;

      const upstream = upstreamFor(path);
      if (upstream === undefined) {
        return {
          ...fail(404, "route_not_found", `no service handles ${path}`),
          headers: { traceparent },
        };
      }

      const limit = limiter.check(callerKey(request.headers));
      const attempt: Attempt = {
        request,
        traceparent,
        upstream,
        limitHeaders: allowanceHeaders(options.perMinute, limit, traceparent),
      };

      const address = options.addressOf(upstream);
      return (
        refusedFor(attempt, limit, address) ??
        (await forward({ ...attempt, call, address: address ?? "", logger: options.logger }))
      );
    },
  };
}

interface ForwardRequest {
  readonly call: typeof globalThis.fetch;
  readonly address: string;
  readonly request: GatewayRequest;
  readonly traceparent: string;
  readonly limitHeaders: Record<string, string>;
  readonly upstream: Upstream;
  readonly logger: Logger;
}

function headersToSend(request: GatewayRequest, traceparent: string): Record<string, string> {
  const out: Record<string, string> = { "content-type": "application/json", traceparent };
  for (const [name, value] of Object.entries(request.headers)) {
    if (name.toLowerCase() === "authorization" && value !== undefined) out["authorization"] = value;
  }
  return out;
}

async function forward(forwarding: ForwardRequest): Promise<GatewayResponse> {
  const { request, traceparent, limitHeaders } = forwarding;

  try {
    const response = await forwarding.call(`${forwarding.address}${request.url}`, {
      method: request.method,
      headers: headersToSend(request, traceparent),
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });

    return {
      status: response.status,
      body: await response.json(),
      headers: limitHeaders,
    };
  } catch (error) {
    // An upstream that is down is a 502, not a 500: the gateway is fine, the service behind it
    // is not, and a caller should be able to tell those apart.
    forwarding.logger.error("upstream unreachable", {
      upstream: forwarding.upstream.name,
      traceparent,
      error,
    });
    return {
      ...fail(502, "upstream_unavailable", `${forwarding.upstream.name} did not respond`),
      headers: limitHeaders,
    };
  }
}
