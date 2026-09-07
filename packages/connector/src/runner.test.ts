import { describe, expect, it, vi } from "vitest";
import { runCall, TIMEOUT_MS } from "./runner.js";
import type { Connector, Result, TrackCall, Tracking } from "./contract.js";

const tracking: Tracking = { status: "in_transit", events: [] };

function connectorThat(track: TrackCall): Connector {
  return { name: "c", version: "1.0.0", capabilities: ["track"], track };
}

const context = { tenantId: "t", credentials: { key: "abc" }, idempotencyKey: "idem-1" };
const request = { carrierReference: "X1" };
const quiet = { attempts: 3, sleep: (): Promise<void> => Promise.resolve() };

const run = (
  connector: Connector,
  options: Record<string, unknown> = {},
): Promise<Result<unknown>> =>
  runCall(connector, "track", { context, request, options: { ...quiet, ...options } });

describe("calling a connector", () => {
  it("returns what it said when it worked", async () => {
    const result = await run(
      connectorThat(() => Promise.resolve({ outcome: "ok", value: tracking })),
    );

    expect(result).toEqual({ outcome: "ok", value: tracking });
  });

  it("refuses a capability the connector never claimed", async () => {
    const nothing: Connector = {
      name: "c",
      version: "1.0.0",
      capabilities: ["quote"],
      quote: () => Promise.resolve({ outcome: "ok", value: [] }),
    };

    const result = await runCall(nothing, "track", { context, request, options: quiet });

    expect(result).toMatchObject({ outcome: "failed", kind: "misconfigured" });
  });

  it("gives every call the same idempotency key on a retry, so nothing is booked twice", async () => {
    const track = vi.fn<TrackCall>((): Promise<Result<Tracking>> =>
      Promise.resolve({ outcome: "failed", kind: "unavailable", message: "down" }),
    );

    await run(connectorThat(track));

    const keys = track.mock.calls.map(([call]) => call.idempotencyKey);
    expect(new Set(keys)).toEqual(new Set(["idem-1"]));
  });
});

describe("when a connector fails", () => {
  it("tries again when the carrier was simply unreachable", async () => {
    const track = vi
      .fn<TrackCall>()
      .mockResolvedValueOnce({ outcome: "failed", kind: "unavailable", message: "down" })
      .mockResolvedValueOnce({ outcome: "ok", value: tracking });

    const result = await run(connectorThat(track));

    expect(result.outcome).toBe("ok");
    expect(track).toHaveBeenCalledTimes(2);
  });

  it("does not try again when the carrier refused, because it will refuse again", async () => {
    const track = vi
      .fn<TrackCall>()
      .mockResolvedValue({ outcome: "failed", kind: "rejected", message: "no such service" });

    await run(connectorThat(track));

    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does not try again when the credentials are wrong, because nobody fixed them mid-call", async () => {
    const track = vi
      .fn<TrackCall>()
      .mockResolvedValue({ outcome: "failed", kind: "misconfigured", message: "bad key" });

    await run(connectorThat(track));

    expect(track).toHaveBeenCalledTimes(1);
  });

  it("waits as long as a throttled carrier asked before trying again", async () => {
    const sleep = vi.fn((): Promise<void> => Promise.resolve());
    const track = vi
      .fn<TrackCall>()
      .mockResolvedValueOnce({ outcome: "failed", kind: "throttled", retryAfterSeconds: 7 })
      .mockResolvedValueOnce({ outcome: "ok", value: tracking });

    await run(connectorThat(track), { sleep });

    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("gives up after the attempts it was given, and says why", async () => {
    const track = vi
      .fn<TrackCall>()
      .mockResolvedValue({ outcome: "failed", kind: "unavailable", message: "down" });

    const result = await run(connectorThat(track));

    expect(track).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ outcome: "failed", kind: "unavailable" });
  });

  it("turns a thrown error into a failure, because a connector is not trusted to behave", async () => {
    const result = await run(
      connectorThat(() => {
        throw new Error("undefined is not a function");
      }),
    );

    expect(result).toMatchObject({ outcome: "failed", kind: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("undefined is not a function");
  });

  it("turns a connector that returns nonsense into a failure", async () => {
    const track = (() => Promise.resolve("yes" as unknown)) as unknown as TrackCall;

    const result = await run(connectorThat(track));

    expect(result).toMatchObject({ outcome: "failed", kind: "unavailable" });
  });
});

describe("a connector that never answers", () => {
  it("is cut off rather than holding a request open forever", async () => {
    const slow: TrackCall = (call) =>
      new Promise((resolve) => {
        call.signal.addEventListener("abort", () => {
          resolve({ outcome: "failed", kind: "unavailable", message: "aborted" });
        });
      });

    const result = await runCall(connectorThat(slow), "track", {
      context,
      request,
      options: { attempts: 1, timeoutMs: 5, sleep: () => Promise.resolve() },
    });

    expect(result).toMatchObject({ outcome: "failed", kind: "unavailable" });
  });

  it("gives a connector a sensible amount of time by default", () => {
    expect(TIMEOUT_MS).toBeGreaterThan(1000);
    expect(TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("a connector that lies about itself", () => {
  it("is refused rather than crashing when it claims a call it does not have", async () => {
    // The registry rejects this at start-up, but runCall is reachable without it.
    const liar = {
      name: "liar",
      version: "1.0.0",
      capabilities: ["track"],
    } as unknown as Connector;

    const result = await runCall(liar, "track", { context, request, options: quiet });

    expect(result).toMatchObject({ outcome: "failed", kind: "misconfigured" });
  });
});

describe("waiting between attempts", () => {
  it("really waits when nobody supplied a clock", async () => {
    const track = vi
      .fn<TrackCall>()
      .mockResolvedValueOnce({ outcome: "failed", kind: "throttled", retryAfterSeconds: 0.01 })
      .mockResolvedValueOnce({ outcome: "ok", value: tracking });

    const startedAt = Date.now();
    const result = await runCall(connectorThat(track), "track", {
      context,
      request,
      options: { attempts: 2 },
    });

    expect(result.outcome).toBe("ok");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5);
  });
});
