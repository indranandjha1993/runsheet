import { describe, expect, it } from "vitest";
import { scanIn, scanOut, type ScanContext } from "./hub-floor.js";

const at = new Date("2026-09-07T10:00:00.000Z");

const context: ScanContext = {
  tenantId: "t",
  hubId: "hub-1",
  workerId: "w1",
  at,
};

describe("scanning a parcel into a hub", () => {
  it("accepts one the hub was expecting", () => {
    const scan = scanIn(context, {
      consignmentId: "c-1",
      expected: true,
      barcode: "RS0000000001",
    });

    expect(scan.accepted).toBe(true);
    expect(scan.hubId).toBe("hub-1");
  });

  it("accepts one nobody expected, but flags it, because the parcel is physically here", () => {
    const scan = scanIn(context, {
      consignmentId: "c-1",
      expected: false,
      barcode: "RS0000000001",
    });

    expect(scan.accepted).toBe(true);
    expect(scan.exception).toBe("unexpected_parcel");
  });

  it("records a weight and dimensions when the hub captures them", () => {
    const scan = scanIn(context, {
      consignmentId: "c-1",
      expected: true,
      barcode: "RS0000000001",
      weightGrams: 1250,
      dimensionsMm: { length: 300, width: 200, height: 100 },
    });

    expect(scan.weightGrams).toBe(1250);
    expect(scan.volumetricGrams).toBe(1200);
  });

  it("flags a weight that differs materially from what was booked", () => {
    const scan = scanIn(context, {
      consignmentId: "c-1",
      expected: true,
      barcode: "RS0000000001",
      weightGrams: 5000,
      bookedWeightGrams: 1200,
    });

    expect(scan.exception).toBe("weight_differs_from_booking");
  });

  it("says nothing about a weight within the allowance", () => {
    const scan = scanIn(context, {
      consignmentId: "c-1",
      expected: true,
      barcode: "RS0000000001",
      weightGrams: 1260,
      bookedWeightGrams: 1200,
    });

    expect(scan.exception).toBeUndefined();
  });

  it("refuses a barcode that is not one of ours", () => {
    expect(() =>
      scanIn(context, { consignmentId: "c-1", expected: true, barcode: "not-a-barcode" }),
    ).toThrow("that barcode is not a Runsheet label");
  });

  it("refuses a scan with no consignment", () => {
    expect(() =>
      scanIn(context, { consignmentId: "", expected: true, barcode: "RS0000000001" }),
    ).toThrow("a scan needs a consignment");
  });
});

describe("scanning a parcel out to a run", () => {
  it("accepts one that is on the run", () => {
    const scan = scanOut(context, {
      consignmentId: "c-1",
      runId: "run-1",
      onRun: true,
      barcode: "RS0000000001",
    });

    expect(scan.accepted).toBe(true);
  });

  it("refuses one that is not on the run, because loading it loses the parcel", () => {
    const scan = scanOut(context, {
      consignmentId: "c-1",
      runId: "run-1",
      onRun: false,
      barcode: "RS0000000001",
    });

    expect(scan.accepted).toBe(false);
    expect(scan.exception).toBe("not_on_this_run");
  });

  it("records who loaded it and when, so a missing parcel can be traced", () => {
    const scan = scanOut(context, {
      consignmentId: "c-1",
      runId: "run-1",
      onRun: true,
      barcode: "RS0000000001",
    });

    expect(scan.workerId).toBe("w1");
    expect(scan.at).toEqual(at);
  });
});
