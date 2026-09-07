import { describe, expect, it } from "vitest";
import { contains, point, polygon } from "./geo.js";

const bengaluruBlock = polygon([
  [12.97, 77.59],
  [12.97, 77.61],
  [12.95, 77.61],
  [12.95, 77.59],
]);

describe("geography", () => {
  it("rejects coordinates outside the possible range", () => {
    expect(() => point(91, 77.6)).toThrow("latitude must be between -90 and 90");
    expect(() => point(12.96, 181)).toThrow("longitude must be between -180 and 180");
  });

  it("rejects a polygon that cannot enclose an area", () => {
    expect(() =>
      polygon([
        [12.97, 77.59],
        [12.95, 77.61],
      ]),
    ).toThrow("a polygon needs at least three points");
  });

  it("holds a point inside its boundary", () => {
    expect(contains(bengaluruBlock, point(12.96, 77.6))).toBe(true);
  });

  it("excludes a point outside its boundary", () => {
    expect(contains(bengaluruBlock, point(12.99, 77.6))).toBe(false);
    expect(contains(bengaluruBlock, point(12.96, 77.7))).toBe(false);
  });

  it("treats a point on the boundary as inside, so adjacent zones never leave a gap", () => {
    expect(contains(bengaluruBlock, point(12.96, 77.59))).toBe(true);
    expect(contains(bengaluruBlock, point(12.97, 77.6))).toBe(true);
  });

  it("handles a concave shape, which real delivery zones often are", () => {
    const concave = polygon([
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 0],
      [3, 0],
      [3, 3],
      [1, 3],
      [1, 0],
    ]);

    expect(contains(concave, point(2, 1))).toBe(false);
    expect(contains(concave, point(2, 3.5))).toBe(true);
  });

  it("closes the ring itself, so the caller need not repeat the first point", () => {
    const closed = polygon([
      [12.97, 77.59],
      [12.97, 77.61],
      [12.95, 77.61],
      [12.95, 77.59],
      [12.97, 77.59],
    ]);

    expect(contains(closed, point(12.96, 77.6))).toBe(true);
  });
});
