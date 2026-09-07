import { describe, expect, it } from "vitest";
import {
  driverFloat,
  entryFor,
  merchantPayable,
  postingsFor,
  type CashEntry,
  type CashMovement,
} from "./cash-ledger.js";

const at = new Date("2026-09-07T10:00:00.000Z");

const collect = (amount: number, consignmentId = "c-1"): CashMovement => ({
  kind: "collected",
  amountMinor: amount,
  currency: "INR",
  driverId: "d-1",
  merchantId: "m-1",
  reference: consignmentId,
  at,
});

const deposit = (amount: number, runId = "run-1"): CashMovement => ({
  kind: "deposited",
  amountMinor: amount,
  currency: "INR",
  driverId: "d-1",
  merchantId: "m-1",
  reference: runId,
  at,
});

const ledger = (movements: CashMovement[]): CashEntry[] =>
  movements.flatMap((movement, index) => entryFor(`e-${String(index)}`, "t", movement));

describe("recording a cash movement", () => {
  it("refuses an amount that is not positive, because direction comes from the kind", () => {
    expect(() => entryFor("e-1", "t", { ...collect(0) })).toThrow(
      "a cash movement must be a positive amount",
    );
    expect(() => entryFor("e-1", "t", { ...collect(-100) })).toThrow(
      "a cash movement must be a positive amount",
    );
  });

  it("refuses a movement with no reference, because unreferenced cash cannot be audited", () => {
    expect(() => entryFor("e-1", "t", { ...collect(100), reference: "" })).toThrow(
      "a cash movement must name what it came from",
    );
  });

  it("keeps the movement kind and its reference on the entry", () => {
    const [entry] = entryFor("e-1", "t", collect(50000));

    expect(entry).toMatchObject({ kind: "collected", reference: "c-1", amountMinor: 50000 });
  });
});

describe("what the postings do to each account", () => {
  it("a collection puts cash in the driver's hands and money the merchant is owed", () => {
    const postings = postingsFor(collect(50000));

    expect(postings).toEqual([
      { account: "driver_float", driverId: "d-1", deltaMinor: 50000 },
      { account: "merchant_payable", merchantId: "m-1", deltaMinor: 50000 },
    ]);
  });

  it("a deposit empties the driver's hands and leaves the merchant still owed", () => {
    const postings = postingsFor(deposit(50000));

    expect(postings).toEqual([{ account: "driver_float", driverId: "d-1", deltaMinor: -50000 }]);
  });

  it("a remittance clears what the merchant is owed and touches no driver", () => {
    const postings = postingsFor({
      kind: "remitted",
      amountMinor: 50000,
      currency: "INR",
      merchantId: "m-1",
      reference: "payout-1",
      at,
    });

    expect(postings).toEqual([{ account: "merchant_payable", merchantId: "m-1", deltaMinor: -50000 }]);
  });

  it("a written-off shortfall clears the driver's float without paying the merchant", () => {
    const postings = postingsFor({
      kind: "written_off",
      amountMinor: 5000,
      currency: "INR",
      driverId: "d-1",
      reference: "run-1",
      at,
    });

    expect(postings).toEqual([{ account: "driver_float", driverId: "d-1", deltaMinor: -5000 }]);
  });
});

describe("what a driver is holding", () => {
  it("is nothing before they collect anything", () => {
    expect(driverFloat([], "d-1", "INR").minorUnits).toBe(0);
  });

  it("is what they collected less what they handed in", () => {
    const entries = ledger([collect(50000), collect(30000, "c-2"), deposit(60000)]);

    expect(driverFloat(entries, "d-1", "INR").minorUnits).toBe(20000);
  });

  it("goes negative when a driver hands in more than they collected, which is a real error", () => {
    const entries = ledger([collect(50000), deposit(60000)]);

    expect(driverFloat(entries, "d-1", "INR").minorUnits).toBe(-10000);
  });

  it("ignores another driver's cash", () => {
    const entries = ledger([collect(50000), { ...collect(90000), driverId: "d-2" }]);

    expect(driverFloat(entries, "d-1", "INR").minorUnits).toBe(50000);
  });

  it("ignores another currency, because floats do not convert themselves", () => {
    const entries = ledger([collect(50000), { ...collect(9000), currency: "AED" }]);

    expect(driverFloat(entries, "d-1", "INR").minorUnits).toBe(50000);
  });
});

describe("what a merchant is owed", () => {
  it("is what was collected for them less what has been paid out", () => {
    const entries = ledger([
      collect(50000),
      collect(30000, "c-2"),
      {
        kind: "remitted",
        amountMinor: 45000,
        currency: "INR",
        merchantId: "m-1",
        reference: "payout-1",
        at,
      },
    ]);

    expect(merchantPayable(entries, "m-1", "INR").minorUnits).toBe(35000);
  });

  it("is unaffected by whether the driver has handed the cash in yet", () => {
    const entries = ledger([collect(50000), deposit(50000)]);

    expect(merchantPayable(entries, "m-1", "INR").minorUnits).toBe(50000);
  });

  it("is not reduced by a shortfall the carrier wrote off, because the merchant is still owed", () => {
    const entries = ledger([
      collect(50000),
      { kind: "written_off", amountMinor: 50000, currency: "INR", driverId: "d-1", reference: "run-1", at },
    ]);

    expect(merchantPayable(entries, "m-1", "INR").minorUnits).toBe(50000);
    expect(driverFloat(entries, "d-1", "INR").minorUnits).toBe(0);
  });
});

describe("undoing a collection that should not have been recorded", () => {
  it("puts both accounts back where they were, without deleting the original", () => {
    const entries = ledger([
      collect(50000),
      {
        kind: "reversed",
        amountMinor: 50000,
        currency: "INR",
        driverId: "d-1",
        merchantId: "m-1",
        reference: "c-1",
        at,
      },
    ]);

    expect(driverFloat(entries, "d-1", "INR").minorUnits).toBe(0);
    expect(merchantPayable(entries, "m-1", "INR").minorUnits).toBe(0);
    expect(entries).toHaveLength(4);
  });
});

describe("what a movement must name", () => {
  it("refuses a collection with no merchant, because the cash belongs to somebody", () => {
    expect(() => entryFor("e-1", "t", { ...collect(100), merchantId: undefined })).toThrow(
      "a collection must name both the driver and the merchant",
    );
  });

  it("refuses a deposit with no driver, because a deposit clears somebody's float", () => {
    expect(() => entryFor("e-1", "t", { ...deposit(100), driverId: undefined })).toThrow(
      "this movement must name the driver",
    );
  });

  it("refuses a remittance with no merchant", () => {
    expect(() =>
      entryFor("e-1", "t", {
        kind: "remitted",
        amountMinor: 100,
        currency: "INR",
        reference: "payout-1",
        at,
      }),
    ).toThrow("this movement must name the merchant");
  });
});

describe("who approved a movement", () => {
  it("is kept on every entry the movement produced", () => {
    const entries = entryFor("e-1", "t", {
      kind: "written_off",
      amountMinor: 5000,
      currency: "INR",
      driverId: "d-1",
      reference: "run-1",
      approvedBy: "supervisor-1",
      at,
    });

    expect(entries[0]).toMatchObject({ approvedBy: "supervisor-1" });
  });
});
