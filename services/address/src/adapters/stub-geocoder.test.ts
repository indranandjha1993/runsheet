import { describe, expect, it } from "vitest";
import { stubGeocoder } from "./stub-geocoder.js";

describe("the geocoder used when none is configured", () => {
  it("places an address in its country with low confidence, because it is a guess", async () => {
    const located = await stubGeocoder().locate("anything", "IN");

    expect(located?.confidence).toBeLessThan(0.2);
    expect(located?.latitude).toBeCloseTo(20.59, 1);
  });

  it("knows both launch markets", async () => {
    expect(await stubGeocoder().locate("anything", "AE")).toBeDefined();
  });

  it("says nothing about a country it does not know, rather than guessing wildly", async () => {
    expect(await stubGeocoder().locate("anything", "GB")).toBeUndefined();
  });
});
