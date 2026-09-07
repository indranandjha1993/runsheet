import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@runsheet/runtime";
import { createProxy } from "./proxy.js";

const logger = createLogger({ service: "gateway", write: () => undefined });
const credential = { authorization: "Bearer rsk_test" };

function upstreamReturning(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

const addressOf = (): string => "http://service.local";

let proxy: ReturnType<typeof createProxy>;

beforeEach(() => {
  proxy = createProxy({
    addressOf,
    perMinute: 100,
    logger,
    fetch: upstreamReturning(200, { ok: true }),
    now: () => 0,
  });
});

const get = (url: string, headers = credential): Promise<{ status: number; body: unknown; headers: Record<string, string> }> =>
  proxy.handle({ method: "GET", url, headers, body: undefined });

describe("passing a request to the right service", () => {
  it("returns what the service said", async () => {
    const response = await get("/v1/consignments/abc");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("reports a path no service handles", async () => {
    const response = await get("/v1/nothing");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: "route_not_found" } });
  });

  it("passes the credential through untouched", async () => {
    const call = upstreamReturning(200, {});
    const proxying = createProxy({ addressOf, perMinute: 100, logger, fetch: call, now: () => 0 });

    await proxying.handle({
      method: "GET",
      url: "/v1/runs",
      headers: credential,
      body: undefined,
    });

    const sent = vi.mocked(call).mock.calls[0]?.[1];
    expect((sent?.headers as Record<string, string>)["authorization"]).toBe("Bearer rsk_test");
  });

  it("does not pass on headers a caller should not be able to set", async () => {
    const call = upstreamReturning(200, {});
    const proxying = createProxy({ addressOf, perMinute: 100, logger, fetch: call, now: () => 0 });

    await proxying.handle({
      method: "GET",
      url: "/v1/runs",
      headers: { ...credential, "x-tenant-id": "someone-else", cookie: "session=abc" },
      body: undefined,
    });

    const sent = (vi.mocked(call).mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(sent["x-tenant-id"]).toBeUndefined();
    expect(sent["cookie"]).toBeUndefined();
  });

  it("carries a trace identifier onto the answer and onward to the service", async () => {
    const response = await get("/v1/consignments");

    expect(response.headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-\d\d$/);
  });

  it("continues a trace the caller started", async () => {
    const response = await proxy.handle({
      method: "GET",
      url: "/v1/consignments",
      headers: {
        ...credential,
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
      body: undefined,
    });

    expect(response.headers["traceparent"]).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("passes a body through on a write", async () => {
    const call = upstreamReturning(201, { id: "c-1" });
    const proxying = createProxy({ addressOf, perMinute: 100, logger, fetch: call, now: () => 0 });

    await proxying.handle({
      method: "POST",
      url: "/v1/consignments",
      headers: credential,
      body: { order_reference: "ORD-1" },
    });

    expect(vi.mocked(call).mock.calls[0]?.[1]?.body).toBe('{"order_reference":"ORD-1"}');
  });

  it("lets the public tracking link through with no credential", async () => {
    const response = await get("/track/abc.def", {});

    expect(response.status).toBe(200);
  });
});

describe("when a service is not there", () => {
  it("says the service is unreachable rather than blaming itself", async () => {
    const proxying = createProxy({
      addressOf,
      perMinute: 100,
      logger,
      fetch: vi.fn(() => Promise.reject(new Error("connection refused"))),
      now: () => 0,
    });

    const response = await proxying.handle({
      method: "GET",
      url: "/v1/runs",
      headers: credential,
      body: undefined,
    });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ error: { code: "upstream_unavailable" } });
  });

  it("says so when a service has no address configured", async () => {
    const proxying = createProxy({
      addressOf: () => undefined,
      perMinute: 100,
      logger,
      fetch: upstreamReturning(200, {}),
      now: () => 0,
    });

    const response = await proxying.handle({
      method: "GET",
      url: "/v1/runs",
      headers: credential,
      body: undefined,
    });

    expect(response.status).toBe(503);
  });
});

describe("holding callers to a rate", () => {
  it("refuses once a caller goes too fast, and says when to retry", async () => {
    const proxying = createProxy({
      addressOf,
      perMinute: 2,
      logger,
      fetch: upstreamReturning(200, {}),
      now: () => 0,
    });
    const send = (): Promise<{ status: number; headers: Record<string, string> }> =>
      proxying.handle({ method: "GET", url: "/v1/runs", headers: credential, body: undefined });

    await send();
    await send();
    const refused = await send();

    expect(refused.status).toBe(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("counts each credential separately", async () => {
    const proxying = createProxy({
      addressOf,
      perMinute: 1,
      logger,
      fetch: upstreamReturning(200, {}),
      now: () => 0,
    });
    await proxying.handle({ method: "GET", url: "/v1/runs", headers: credential, body: undefined });

    const other = await proxying.handle({
      method: "GET",
      url: "/v1/runs",
      headers: { authorization: "Bearer rsk_other" },
      body: undefined,
    });

    expect(other.status).toBe(200);
  });

  it("tells every caller how much allowance is left", async () => {
    const response = await get("/v1/runs");

    expect(response.headers["ratelimit-limit"]).toBe("100");
    expect(response.headers["ratelimit-remaining"]).toBe("99");
  });
});
