import { beforeEach, describe, expect, it } from "vitest";
import { createRouter, type Route } from "./http.js";

const routes: Route[] = [
  {
    method: "GET",
    path: "/v1/hubs/:code",
    handle: (request) => Promise.resolve({ status: 200, body: { code: request.params["code"] } }),
  },
  {
    method: "POST",
    path: "/v1/hubs",
    handle: (request) => Promise.resolve({ status: 201, body: { received: request.body } }),
  },
  {
    method: "GET",
    path: "/v1/boom",
    handle: () => Promise.reject(new Error("something specific went wrong")),
  },
];

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(routes);
});

describe("the router", () => {
  it("matches a path and hands over the captured parts", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/hubs/BLR-01",
      headers: {},
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ code: "BLR-01" });
  });

  it("passes the parsed body through on a write", async () => {
    const response = await router.handle({
      method: "POST",
      url: "/v1/hubs",
      headers: {},
      body: { code: "BLR-02" },
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ received: { code: "BLR-02" } });
  });

  it("answers an unknown path with a machine-readable error", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/nothing-here",
      headers: {},
      body: undefined,
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: "route_not_found" } });
  });

  it("distinguishes a wrong method from a wrong path", async () => {
    const response = await router.handle({
      method: "DELETE",
      url: "/v1/hubs",
      headers: {},
      body: undefined,
    });

    expect(response.status).toBe(405);
    expect(response.body).toMatchObject({ error: { code: "method_not_allowed" } });
  });

  it("turns an unexpected failure into a 500 without leaking its message", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/boom",
      headers: {},
      body: undefined,
    });

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("something specific");
  });

  it("carries a trace identifier onto every response so a log line can be found", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/hubs/BLR-01",
      headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
      body: undefined,
    });

    expect(response.headers?.["traceparent"]).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("matches a path with no captured parts", async () => {
    const plain = createRouter([
      {
        method: "GET",
        path: "/v1/ping",
        handle: () => Promise.resolve({ status: 200, body: "pong" }),
      },
    ]);

    const response = await plain.handle({
      method: "GET",
      url: "/v1/ping",
      headers: {},
      body: undefined,
    });

    expect(response.body).toBe("pong");
  });

  it("lets a handler set its own headers alongside the trace", async () => {
    const custom = createRouter([
      {
        method: "GET",
        path: "/v1/thing",
        handle: () =>
          Promise.resolve({ status: 200, body: {}, headers: { "cache-control": "no-store" } }),
      },
    ]);

    const response = await custom.handle({
      method: "GET",
      url: "/v1/thing",
      headers: {},
      body: undefined,
    });

    expect(response.headers?.["cache-control"]).toBe("no-store");
    expect(response.headers?.["traceparent"]).toBeDefined();
  });

  it("ignores a query string when matching", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/hubs/BLR-01?expand=zones",
      headers: {},
      body: undefined,
    });

    expect(response.status).toBe(200);
  });
});
