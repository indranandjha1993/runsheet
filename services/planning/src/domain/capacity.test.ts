import { describe, expect, it } from "vitest";
import { byDistanceFrom, fits, packInto, type Vehicle, type Job } from "./capacity.js";

const van = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "v1",
  maxStops: 3,
  maxWeightGrams: 50_000,
  shiftMinutes: 480,
  ...over,
});

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  weightGrams: 10_000,
  serviceMinutes: 5,
  location: { latitude: 12.97, longitude: 77.6 },
  ...over,
});

describe("what a vehicle can carry", () => {
  it("accepts a load inside every limit", () => {
    expect(fits(van(), [job("a"), job("b")])).toBe(true);
  });

  it("refuses more stops than the vehicle is allowed", () => {
    expect(fits(van(), [job("a"), job("b"), job("c"), job("d")])).toBe(false);
  });

  it("refuses more weight than the vehicle can take", () => {
    expect(fits(van({ maxWeightGrams: 15_000 }), [job("a"), job("b")])).toBe(false);
  });

  it("refuses a load that could not be served within the shift", () => {
    expect(fits(van({ shiftMinutes: 5 }), [job("a"), job("b")])).toBe(false);
  });

  it("accepts an empty load, because an idle van is not an error", () => {
    expect(fits(van(), [])).toBe(true);
  });
});

describe("packing a day's work into vehicles", () => {
  it("puts everything into one vehicle when it fits", () => {
    const packed = packInto([van()], [job("a"), job("b")]);

    expect(packed.assigned).toHaveLength(1);
    expect(packed.assigned[0]?.jobs).toHaveLength(2);
    expect(packed.unassigned).toHaveLength(0);
  });

  it("spreads work across vehicles when one cannot take it all", () => {
    const packed = packInto([van({ id: "v1" }), van({ id: "v2" })], [
      job("a"), job("b"), job("c"), job("d"), job("e"),
    ]);

    expect(packed.assigned).toHaveLength(2);
    expect(packed.unassigned).toHaveLength(0);
  });

  it("reports what it could not fit rather than silently dropping it", () => {
    const packed = packInto([van({ maxStops: 1 })], [job("a"), job("b"), job("c")]);

    expect(packed.assigned[0]?.jobs).toHaveLength(1);
    expect(packed.unassigned.map((j) => j.id)).toEqual(["b", "c"]);
  });

  it("reports everything as unassigned when there are no vehicles", () => {
    const packed = packInto([], [job("a")]);

    expect(packed.assigned).toHaveLength(0);
    expect(packed.unassigned).toHaveLength(1);
  });

  it("leaves a vehicle out of the plan when it got no work", () => {
    const packed = packInto([van({ id: "v1" }), van({ id: "v2" })], [job("a")]);

    expect(packed.assigned).toHaveLength(1);
    expect(packed.assigned[0]?.vehicle.id).toBe("v1");
  });

  it("respects weight as well as stop count when spreading", () => {
    const heavy = (id: string): Job => job(id, { weightGrams: 30_000 });

    const packed = packInto([van({ id: "v1" }), van({ id: "v2" })], [
      heavy("a"), heavy("b"), heavy("c"),
    ]);

    expect(packed.assigned.map((a) => a.jobs.length)).toEqual([1, 1]);
    expect(packed.unassigned.map((j) => j.id)).toEqual(["c"]);
  });
});

describe("ordering stops by distance", () => {
  const at = { latitude: 12.9, longitude: 77.6 };

  it("puts the nearest first", () => {
    const sorted = [job("far", { location: { latitude: 13.5, longitude: 77.6 } }), job("near", { location: { latitude: 12.91, longitude: 77.6 } })].sort(
      byDistanceFrom(at),
    );

    expect(sorted.map((j) => j.id)).toEqual(["near", "far"]);
  });

  it("breaks a tie by identifier, so the order never depends on input order", () => {
    const same = { latitude: 12.91, longitude: 77.6 };
    const forwards = [job("zulu", { location: same }), job("alpha", { location: same })].sort(
      byDistanceFrom(at),
    );
    const backwards = [job("alpha", { location: same }), job("zulu", { location: same })].sort(
      byDistanceFrom(at),
    );

    expect(forwards.map((j) => j.id)).toEqual(["alpha", "zulu"]);
    expect(backwards.map((j) => j.id)).toEqual(forwards.map((j) => j.id));
  });
});
