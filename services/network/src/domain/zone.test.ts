import { describe, expect, it } from "vitest";
import { point, polygon } from "./geo.js";
import { resolveZone, type Zone } from "./zone.js";

const block = (lat: number, lon: number): ReturnType<typeof polygon> =>
  polygon([
    [lat, lon],
    [lat, lon + 0.02],
    [lat - 0.02, lon + 0.02],
    [lat - 0.02, lon],
  ]);

interface ZoneFixture {
  id: string;
  hubId: string;
  priority: number;
  at: [number, number];
}

const zone = ({ id, hubId, priority, at }: ZoneFixture): Zone => ({
  id,
  hubId,
  priority,
  boundary: block(at[0], at[1]),
  active: true,
});

describe("zone resolution", () => {
  it("finds the zone whose boundary holds the point", () => {
    const zones = [
      zone({ id: "z-north", hubId: "hub-a", priority: 0, at: [12.99, 77.59] }),
      zone({ id: "z-south", hubId: "hub-b", priority: 0, at: [12.97, 77.59] }),
    ];

    expect(resolveZone(zones, point(12.98, 77.6))?.id).toBe("z-north");
    expect(resolveZone(zones, point(12.96, 77.6))?.id).toBe("z-south");
  });

  it("returns nothing when no zone covers the point", () => {
    expect(resolveZone([zone({ id: "z", hubId: "hub-a", priority: 0, at: [12.99, 77.59] })], point(1, 1))).toBeUndefined();
  });

  it("prefers the higher priority zone where two overlap", () => {
    const zones = [
      zone({ id: "z-wide", hubId: "hub-a", priority: 0, at: [12.99, 77.59] }),
      zone({ id: "z-precise", hubId: "hub-b", priority: 10, at: [12.99, 77.59] }),
    ];

    expect(resolveZone(zones, point(12.98, 77.6))?.id).toBe("z-precise");
  });

  it("resolves a priority tie by zone identifier, so the answer never depends on input order", () => {
    const a = { ...zone({ id: "z-alpha", hubId: "hub-a", priority: 5, at: [12.99, 77.59] }) };
    const b = { ...zone({ id: "z-beta", hubId: "hub-b", priority: 5, at: [12.99, 77.59] }) };
    const at = point(12.98, 77.6);

    expect(resolveZone([a, b], at)?.id).toBe("z-alpha");
    expect(resolveZone([b, a], at)?.id).toBe("z-alpha");
  });

  it("ignores a deactivated zone even when it covers the point", () => {
    const zones = [
      { ...zone({ id: "z-off", hubId: "hub-a", priority: 10, at: [12.99, 77.59] }), active: false },
      zone({ id: "z-on", hubId: "hub-b", priority: 0, at: [12.99, 77.59] }),
    ];

    expect(resolveZone(zones, point(12.98, 77.6))?.id).toBe("z-on");
  });

  it("returns nothing when every covering zone is deactivated", () => {
    const off = { ...zone({ id: "z-off", hubId: "hub-a", priority: 0, at: [12.99, 77.59] }), active: false };

    expect(resolveZone([off], point(12.98, 77.6))).toBeUndefined();
  });
});
