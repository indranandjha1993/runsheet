import { describe, expect, it } from "vitest";
import { priceFor, rateCard, type RateCardInput } from "./rate-card.js";

const card = (over: Partial<RateCardInput> = {}) =>
  rateCard({
    id: "rc-1",
    tenantId: "t",
    carrierAccountId: "ca-1",
    currency: "INR",
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    lanes: [
      {
        origin: "BLR",
        destination: "HYD",
        service: "next_day",
        bands: [
          { upToGrams: 500, priceMinor: 6000 },
          { upToGrams: 2000, priceMinor: 9000 },
          { upToGrams: 10000, priceMinor: 18000 },
        ],
        surcharges: [{ code: "fuel", percent: 12 }],
      },
    ],
    ...over,
  });

const shipment = {
  origin: "BLR",
  destination: "HYD",
  service: "next_day",
  weightGrams: 1200,
  at: new Date("2026-09-07T10:00:00.000Z"),
};

describe("a rate card", () => {
  it("refuses one with no lanes", () => {
    expect(() => card({ lanes: [] })).toThrow("a rate card needs at least one lane");
  });

  it("refuses weight bands that are not in order", () => {
    expect(() =>
      card({
        lanes: [
          {
            origin: "BLR",
            destination: "HYD",
            service: "next_day",
            bands: [
              { upToGrams: 2000, priceMinor: 9000 },
              { upToGrams: 500, priceMinor: 6000 },
            ],
            surcharges: [],
          },
        ],
      }),
    ).toThrow("weight bands must be in ascending order");
  });

  it("refuses a surcharge that is not a percentage", () => {
    expect(() =>
      card({
        lanes: [
          {
            origin: "BLR",
            destination: "HYD",
            service: "next_day",
            bands: [{ upToGrams: 500, priceMinor: 6000 }],
            surcharges: [{ code: "fuel", percent: 150 }],
          },
        ],
      }),
    ).toThrow("a surcharge must be between 0 and 100 percent");
  });
});

describe("pricing a shipment", () => {
  it("charges the band the weight falls into", () => {
    const priced = priceFor(card(), shipment);

    expect(priced?.baseMinor).toBe(9000);
  });

  it("adds each surcharge and shows how it was reached", () => {
    const priced = priceFor(card(), shipment);

    expect(priced?.surcharges).toEqual([{ code: "fuel", amountMinor: 1080 }]);
    expect(priced?.totalMinor).toBe(10080);
  });

  it("charges the first band for anything under it", () => {
    expect(priceFor(card(), { ...shipment, weightGrams: 100 })?.baseMinor).toBe(6000);
  });

  it("charges the top band for anything at its limit", () => {
    expect(priceFor(card(), { ...shipment, weightGrams: 10000 })?.baseMinor).toBe(18000);
  });

  it("prices nothing above the heaviest band, rather than guessing", () => {
    expect(priceFor(card(), { ...shipment, weightGrams: 50000 })).toBeUndefined();
  });

  it("prices nothing for a lane the card does not cover", () => {
    expect(priceFor(card(), { ...shipment, destination: "DEL" })).toBeUndefined();
    expect(priceFor(card(), { ...shipment, service: "same_day" })).toBeUndefined();
  });

  it("prices nothing before the card takes effect", () => {
    expect(
      priceFor(card(), { ...shipment, at: new Date("2025-12-31T00:00:00.000Z") }),
    ).toBeUndefined();
  });

  it("prices nothing after the card expires", () => {
    const expiring = card({ validUntil: new Date("2026-06-01T00:00:00.000Z") });

    expect(priceFor(expiring, shipment)).toBeUndefined();
  });

  it("rounds a surcharge to whole minor units, never a fraction of a paisa", () => {
    const odd = card({
      lanes: [
        {
          origin: "BLR",
          destination: "HYD",
          service: "next_day",
          bands: [{ upToGrams: 2000, priceMinor: 3333 }],
          surcharges: [{ code: "fuel", percent: 12 }],
        },
      ],
    });

    const priced = priceFor(odd, shipment);

    expect(Number.isInteger(priced?.surcharges[0]?.amountMinor)).toBe(true);
    expect(priced?.totalMinor).toBe(3333 + 400);
  });
});
