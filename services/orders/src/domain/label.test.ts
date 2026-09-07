import { describe, expect, it } from "vitest";
import { barcodeFor, labelFor, type LabelRequest } from "./label.js";

const request: LabelRequest = {
  consignmentId: "01J8Z0T0000000000000000010",
  reference: "ORD-4471",
  serial: 4471,
  piece: 1,
  pieces: 1,
  origin: { hubCode: "BLR1", city: "Bengaluru" },
  destination: {
    hubCode: "DEL3",
    name: "Aarav Sharma",
    line: "Flat 402, Sunrise Apartments",
    locality: "Sector 62",
    city: "Noida",
    postcode: "201309",
  },
  serviceLevel: "next_day",
  sortCode: "DEL3-N-04",
  weightGrams: 1250,
  codAmountMinor: 149900,
  currency: "INR",
};

describe("building a label", () => {
  it("carries the barcode and the sort code the hub sorts by", () => {
    const label = labelFor(request);

    expect(label.barcode).toBe(barcodeFor(4471));
    expect(label.sortCode).toBe("DEL3-N-04");
  });

  it("shows the amount to collect when there is cash to collect", () => {
    expect(labelFor(request).cod).toBe("1499.00 INR");
  });

  it("says nothing about cash when there is none, so nobody asks for money", () => {
    const label = labelFor({ ...request, codAmountMinor: 0 });

    expect(label.cod).toBeUndefined();
  });

  it("numbers each piece of a multi-piece consignment", () => {
    const label = labelFor({ ...request, piece: 2, pieces: 3 });

    expect(label.pieceOf).toBe("2 of 3");
    expect(label.barcode).not.toBe(labelFor(request).barcode);
  });

  it("gives a single-piece consignment no piece count to read", () => {
    expect(labelFor(request).pieceOf).toBeUndefined();
  });

  it("refuses a piece number outside the count, because that parcel does not exist", () => {
    expect(() => labelFor({ ...request, piece: 4, pieces: 3 })).toThrow(
      "piece 4 of 3 is not a parcel",
    );
  });

  it("puts the destination address on it in the order somebody reads it", () => {
    expect(labelFor(request).address).toEqual([
      "Aarav Sharma",
      "Flat 402, Sunrise Apartments",
      "Sector 62",
      "Noida 201309",
    ]);
  });

  it("leaves out an address line that is missing rather than printing a blank", () => {
    const label = labelFor({
      ...request,
      destination: { ...request.destination, locality: undefined },
    });

    expect(label.address).toEqual([
      "Aarav Sharma",
      "Flat 402, Sunrise Apartments",
      "Noida 201309",
    ]);
  });

  it("shows the weight in kilograms, because that is what the floor reads", () => {
    expect(labelFor(request).weight).toBe("1.25 kg");
  });
});
