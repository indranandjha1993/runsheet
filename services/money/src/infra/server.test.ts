import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "@runsheet/runtime";
import { createHttpServer, serviceLogger } from "./server.js";
import type { Probe } from "@runsheet/runtime";

const silent = createLogger({ service: "test", write: () => undefined });

function start(
  routerBody: unknown,
  status = 200,
  probes: Probe[] = [],
): { url: string; close: () => Promise<void> } {
  const server = createHttpServer({
    router: { handle: () => Promise.resolve({ status, body: routerBody }) },
    probes,
    logger: silent,
    port: 0,
  });
  server.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

let running: { url: string; close: () => Promise<void> } | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("the service logger", () => {
  it("builds a logger at the level the configuration asked for", () => {
    expect(() => {
      serviceLogger("network", "warn").warn("started");
    }).not.toThrow();
  });
});

describe("the http server", () => {
  it("answers a request with json and the status the router chose", async () => {
    running = start({ ok: true }, 201);

    const response = await fetch(`${running.url}/v1/anything`, { method: "POST" });

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("reports ready when every probe passes", async () => {
    running = start({}, 200, [{ name: "database", check: () => Promise.resolve() }]);

    const response = await fetch(`${running.url}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready" });
  });

  it("reports not ready with a failing probe, so a load balancer stops sending work", async () => {
    running = start({}, 200, [
      { name: "database", check: () => Promise.reject(new Error("connection refused")) },
    ]);

    const response = await fetch(`${running.url}/health`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "not_ready" });
  });

  it("passes a json body through to the router", async () => {
    const seen: unknown[] = [];
    const server = createHttpServer({
      router: {
        handle: (request) => {
          seen.push(request.body);
          return Promise.resolve({ status: 200, body: {} });
        },
      },
      probes: [],
      logger: silent,
      port: 0,
    });
    server.listen(0);
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    running = {
      url: `http://127.0.0.1:${String(port)}`,
      close: () =>
        new Promise((resolve) =>
          server.close(() => {
            resolve();
          }),
        ),
    };

    await fetch(`${running.url}/v1/hubs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "BLR-01" }),
    });

    expect(seen).toEqual([{ code: "BLR-01" }]);
  });

  it("does not crash on a body that is not json", async () => {
    running = start({ ok: true });

    const response = await fetch(`${running.url}/v1/hubs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    expect(response.status).toBe(200);
  });
});
