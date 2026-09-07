import { describe, expect, it } from "vitest";
import { reconcile, type DeviceEntry, type Handshake } from "./device-clock.js";

const serverNow = new Date("2026-09-07T18:00:00.000Z");

const handshake: Handshake = {
  deviceBootId: "boot-1",
  monotonicNowMs: 6 * 3_600_000,
  offsetMs: 0,
  anchorBootId: "boot-1",
  serverReceivedAt: serverNow,
};

const entry = (sequence: number, deviceIso: string, monotonicMs: number): DeviceEntry => ({
  deviceSequence: sequence,
  occurredAtDevice: new Date(deviceIso),
  monotonicMs,
});

describe("reconciling a device clock that is right", () => {
  it("keeps the time the device reported", () => {
    const [first] = reconcile(handshake, [entry(1, "2026-09-07T17:00:00.000Z", 5 * 3_600_000)]);

    expect(first?.occurredAt.toISOString()).toBe("2026-09-07T17:00:00.000Z");
    expect(first?.confidence).toBe(1);
    expect(first?.flags).toEqual([]);
  });

  it("trusts the monotonic anchor over the wall clock", () => {
    const skewed: Handshake = { ...handshake, offsetMs: 0 };
    const [first] = reconcile(skewed, [entry(1, "2020-01-01T00:00:00.000Z", 5 * 3_600_000)]);

    expect(first?.occurredAt.toISOString()).toBe("2026-09-07T17:00:00.000Z");
  });
});

describe("reconciling a clock that has drifted", () => {
  it("takes the drift in its stride when it is under two minutes", () => {
    const [first] = reconcile(handshake, [entry(1, "2026-09-07T17:01:00.000Z", 5 * 3_600_000)]);

    expect(first?.confidence).toBe(1);
    expect(first?.flags).toEqual([]);
  });

  it("marks a reconstruction when the drift runs to minutes", () => {
    const [first] = reconcile(handshake, [entry(1, "2026-09-07T17:05:00.000Z", 5 * 3_600_000)]);

    expect(first?.confidence).toBe(0.8);
    expect(first?.flags).toEqual(["time_reconstructed"]);
  });

  it("calls the clock unreliable when the drift runs past a quarter of an hour", () => {
    const [first] = reconcile(handshake, [entry(1, "2026-09-07T15:00:00.000Z", 5 * 3_600_000)]);

    expect(first?.confidence).toBe(0.6);
    expect(first?.flags).toContain("device_clock_unreliable");
  });
});

describe("reconciling when the anchor cannot be trusted", () => {
  const rebooted: Handshake = { ...handshake, anchorBootId: "boot-0" };

  it("spreads the entries evenly and says so", () => {
    const reconciled = reconcile(rebooted, [
      entry(1, "2020-01-01T00:00:00.000Z", 1000),
      entry(2, "2020-01-01T00:00:00.000Z", 2000),
      entry(3, "2020-01-01T00:00:00.000Z", 3000),
    ]);

    expect(reconciled.map((r) => r.confidence)).toEqual([0.4, 0.4, 0.4]);
    expect(reconciled[0]?.flags).toContain("time_estimated");
    expect(reconciled[0]?.occurredAt.getTime()).toBeLessThan(
      reconciled[2]?.occurredAt.getTime() ?? 0,
    );
  });

  it("never puts an estimated time after the moment the server received it", () => {
    const reconciled = reconcile(rebooted, [entry(1, "2030-01-01T00:00:00.000Z", 1000)]);

    expect(reconciled[0]?.occurredAt.getTime()).toBeLessThanOrEqual(serverNow.getTime());
  });
});

describe("keeping a batch in the order the driver worked", () => {
  it("corrects a wall clock that went backwards without any fuss", () => {
    const reconciled = reconcile(handshake, [
      entry(1, "2026-09-07T17:00:00.000Z", 5 * 3_600_000),
      entry(2, "2026-09-07T16:00:00.000Z", 5 * 3_600_000 + 1),
    ]);

    const [first, second] = reconciled;
    expect(second?.occurredAt.getTime()).toBeGreaterThan(first?.occurredAt.getTime() ?? 0);
  });

  it("separates two taps the device says happened in the same millisecond", () => {
    const reconciled = reconcile(handshake, [
      entry(1, "2026-09-07T17:00:00.000Z", 5 * 3_600_000),
      entry(2, "2026-09-07T17:00:00.000Z", 5 * 3_600_000),
    ]);

    const [first, second] = reconciled;
    expect(second?.occurredAt.getTime()).toBe((first?.occurredAt.getTime() ?? 0) + 1);
    expect(second?.flags).toContain("time_clamped");
  });

  it("stops trusting the counter when it runs backwards, which it must never do", () => {
    const reconciled = reconcile(handshake, [
      entry(1, "2026-09-07T17:00:00.000Z", 5 * 3_600_000),
      entry(2, "2026-09-07T17:30:00.000Z", 4 * 3_600_000),
    ]);

    expect(reconciled.every((r) => r.confidence === 0.4)).toBe(true);
    expect(reconciled[0]?.flags).toContain("time_estimated");
  });

  it("reads the entries in device order however they arrived", () => {
    const reconciled = reconcile(handshake, [
      entry(2, "2026-09-07T17:30:00.000Z", 5 * 3_600_000 + 1800_000),
      entry(1, "2026-09-07T17:00:00.000Z", 5 * 3_600_000),
    ]);

    expect(reconciled.map((r) => r.deviceSequence)).toEqual([1, 2]);
  });
});

describe("clamping against the server", () => {
  it("never accepts a time from the future", () => {
    const [first] = reconcile({ ...handshake, monotonicNowMs: 0 }, [
      entry(1, "2030-01-01T00:00:00.000Z", 3_600_000),
    ]);

    expect(first?.occurredAt.getTime()).toBeLessThanOrEqual(serverNow.getTime());
    expect(first?.flags).toContain("time_clamped");
  });
});
