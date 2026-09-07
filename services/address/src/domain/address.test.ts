import { describe, expect, it } from "vitest";
import { confirmPin, resolveAddress, type Address } from "./address.js";

const at = new Date("2026-09-07T10:00:00.000Z");

const resolved = (): Address =>
  resolveAddress({
    id: "addr-1",
    tenantId: "t",
    raw: "Flat 4B, near Sai Temple, Indiranagar, Bengaluru 560038",
    countryCode: "IN",
    geocoded: { latitude: 12.97, longitude: 77.64, confidence: 0.6 },
    at,
  });

describe("resolving an address", () => {
  it("keeps the geocoder's answer with its confidence", () => {
    const address = resolved();

    expect(address.location?.latitude).toBe(12.97);
    expect(address.source).toBe("geocoder");
  });

  it("stands on its own when no geocoder could place it", () => {
    const address = resolveAddress({
      id: "a",
      tenantId: "t",
      raw: "somewhere near the lake",
      countryCode: "IN",
      at,
    });

    expect(address.location).toBeUndefined();
    expect(address.confidence).toBeLessThan(0.5);
  });

  it("scores a rich address above a bare one even with the same geocoder confidence", () => {
    const bare = resolveAddress({
      id: "a",
      tenantId: "t",
      raw: "Bengaluru",
      countryCode: "IN",
      geocoded: { latitude: 12.97, longitude: 77.64, confidence: 0.6 },
      at,
    });

    expect(resolved().confidence).toBeGreaterThan(bare.confidence);
  });
});

describe("guarding the geocoder", () => {
  it("refuses a geocoded pin outside the possible range", () => {
    expect(() =>
      resolveAddress({
        id: "a",
        tenantId: "t",
        raw: "MG Road, Bengaluru 560001",
        countryCode: "IN",
        geocoded: { latitude: 0, longitude: 181, confidence: 0.9 },
        at,
      }),
    ).toThrow("longitude must be between -180 and 180");
  });
});

describe("a driver confirming where the door actually is", () => {
  it("replaces the geocoder's guess and trusts it more", () => {
    const corrected = confirmPin(resolved(), {
      latitude: 12.9712,
      longitude: 77.6402,
      workerId: "w1",
      at: new Date("2026-09-07T11:00:00.000Z"),
    });

    expect(corrected.location?.latitude).toBe(12.9712);
    expect(corrected.source).toBe("driver");
    expect(corrected.confidence).toBeGreaterThan(resolved().confidence);
  });

  it("grows more certain as more drivers agree", () => {
    const once = confirmPin(resolved(), { latitude: 12.9712, longitude: 77.6402, workerId: "w1", at });
    const twice = confirmPin(once, { latitude: 12.9713, longitude: 77.6401, workerId: "w2", at });

    expect(twice.confirmations).toBe(2);
    expect(twice.confidence).toBeGreaterThan(once.confidence);
  });

  it("never becomes completely certain, because a door can still move", () => {
    let address = resolved();
    for (let i = 0; i < 20; i += 1) {
      address = confirmPin(address, {
        latitude: 12.9712,
        longitude: 77.6402,
        workerId: `w${String(i)}`,
        at,
      });
    }

    expect(address.confidence).toBeLessThan(1);
    expect(address.confidence).toBeGreaterThan(0.9);
  });

  it("resets its certainty when a driver puts the pin somewhere far away", () => {
    const agreed = confirmPin(resolved(), {
      latitude: 12.9712,
      longitude: 77.6402,
      workerId: "w1",
      at,
    });

    const disagreed = confirmPin(agreed, {
      latitude: 13.5,
      longitude: 78.1,
      workerId: "w2",
      at,
    });

    expect(disagreed.confirmations).toBe(1);
    expect(disagreed.location?.latitude).toBe(13.5);
  });

  it("outranks even a perfect geocoder result, because someone stood there", () => {
    const perfect = resolveAddress({
      id: "a",
      tenantId: "t",
      raw: "Flat 4B, near Sai Temple, Indiranagar, Bengaluru 560038",
      countryCode: "IN",
      geocoded: { latitude: 12.97, longitude: 77.64, confidence: 1 },
      at,
    });

    const confirmed = confirmPin(perfect, {
      latitude: 12.9712,
      longitude: 77.6402,
      workerId: "w1",
      at,
    });

    expect(confirmed.confidence).toBeGreaterThanOrEqual(perfect.confidence);
  });

  it("refuses a longitude outside the possible range", () => {
    expect(() =>
      confirmPin(resolved(), { latitude: 0, longitude: 181, workerId: "w", at }),
    ).toThrow("longitude must be between -180 and 180");
  });

  it("refuses a pin outside the possible range", () => {
    expect(() =>
      confirmPin(resolved(), { latitude: 91, longitude: 0, workerId: "w", at }),
    ).toThrow("latitude must be between -90 and 90");
  });

  it("records who moved it and when, so a bad pin can be traced", () => {
    const corrected = confirmPin(resolved(), {
      latitude: 12.9712,
      longitude: 77.6402,
      workerId: "w7",
      at: new Date("2026-09-07T11:00:00.000Z"),
    });

    expect(corrected.lastConfirmedBy).toBe("w7");
    expect(corrected.lastConfirmedAt).toEqual(new Date("2026-09-07T11:00:00.000Z"));
  });
});
