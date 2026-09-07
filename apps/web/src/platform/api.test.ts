import { describe, expect, it, vi } from "vitest";
import { createApi } from "./api.js";

const answering = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    ),
  );

describe("calling the platform", () => {
  it("sends the key on every request", async () => {
    const call = answering(200, { ok: true });
    const api = createApi({ key: () => "rsk_abc", fetch: call });

    await api.get("/v1/callers/current");

    const sent = vi.mocked(call).mock.calls[0]?.[1];
    expect((sent?.headers as Record<string, string>)["authorization"]).toBe("Bearer rsk_abc");
  });

  it("sends nothing when there is no key, so the platform can say so", async () => {
    const call = answering(401, { error: { code: "unauthorised", message: "no" } });
    const api = createApi({ key: () => undefined, fetch: call });

    const result = await api.get("/v1/consignments");

    expect(result).toMatchObject({ ok: false, error: { status: 401, code: "unauthorised" } });
  });

  it("returns what the platform said when it worked", async () => {
    const api = createApi({ key: () => "rsk_abc", fetch: answering(200, { consignments: [] }) });

    const result = await api.get<{ consignments: unknown[] }>("/v1/consignments");

    expect(result).toEqual({ ok: true, value: { consignments: [] } });
  });

  it("returns the platform's own error, with the trace to quote", async () => {
    const api = createApi({
      key: () => "rsk_abc",
      fetch: answering(409, { error: { code: "transition_not_allowed", message: "no" } }, { traceparent: "00-abc-def-01" }),
    });

    const result = await api.post("/v1/runs/r1/events", { type: "closed" });

    expect(result).toMatchObject({
      ok: false,
      error: { status: 409, code: "transition_not_allowed", traceparent: "00-abc-def-01" },
    });
  });

  it("says the platform is unreachable rather than throwing", async () => {
    const api = createApi({
      key: () => "rsk_abc",
      fetch: vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error("offline"))),
    });

    const result = await api.get("/v1/reports");

    expect(result).toMatchObject({ ok: false, error: { code: "unreachable" } });
  });

  it("copes with a reply that is not the error shape", async () => {
    const api = createApi({ key: () => "rsk_abc", fetch: answering(502, "Bad Gateway") });

    const result = await api.get("/v1/reports");

    expect(result).toMatchObject({ ok: false, error: { status: 502, code: "unreadable_reply" } });
  });

  it("downloads a file with the name the platform gave it", async () => {
    const api = createApi({
      key: () => "rsk_abc",
      fetch: answering(200, "day,hub\n2026-09-07,BLR1\n", {
        "content-type": "text/csv",
        "content-disposition": 'attachment; filename="delivery_performance.csv"',
      }),
    });

    const result = await api.file("/v1/reports/delivery_performance?format=csv");

    expect(result).toEqual({
      ok: true,
      value: { text: "day,hub\n2026-09-07,BLR1\n", filename: "delivery_performance.csv" },
    });
  });
});
