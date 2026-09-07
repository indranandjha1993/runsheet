import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresMoney } from "./repository.js";
import { rateCard } from "../domain/rate-card.js";
import type { InvoiceLine, Settlement } from "../domain/settlement.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_money",
});
const repository = postgresMoney(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";
const carrierAccountId = "01J8Z0T0000000000000000010";

const carrier = { id: carrierAccountId, tenantId, name: "Regional Express", currency: "INR" };
const invoice = { id: "01J8Z0T0000000000000000020", tenantId, carrierAccountId, number: "INV-1", currency: "INR" };
const line: InvoiceLine = {
  id: "01J8Z0T0000000000000000030",
  invoiceId: invoice.id,
  consignmentId: "c-1",
  billedMinor: 10080,
  currency: "INR",
  billedWeightGrams: 1200,
};
const settlement: Settlement = {
  id: "01J8Z0T0000000000000000040",
  tenantId,
  lineId: line.id,
  invoiceId: invoice.id,
  state: "mismatched",
  varianceMinor: 1920,
  reasons: ["billed_above_contract"],
  autoApproved: false,
};

beforeEach(async () => {
  await pool.query(
    `DROP TABLE IF EXISTS cash_entries, cash_movements, settlements, invoice_lines, invoices,
       rate_cards, carrier_accounts, aggregate_streams, schema_migrations CASCADE`,
  );
  await migrate(pool, migrations);
  await repository.saveCarrier(carrier);
});

afterAll(async () => {
  await pool.end();
});

describe("the money repository", () => {
  it("round-trips a carrier account", async () => {
    expect(await repository.carrierById(tenantId, carrierAccountId)).toEqual(carrier);
  });

  it("keeps one tenant's carriers invisible to another", async () => {
    expect(await repository.carrierById("other", carrierAccountId)).toBeUndefined();
  });

  it("round-trips a rate card with its lanes and bands", async () => {
    const card = rateCard({
      id: "01J8Z0T0000000000000000050",
      tenantId,
      carrierAccountId,
      currency: "INR",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      lanes: [
        {
          origin: "BLR",
          destination: "HYD",
          service: "next_day",
          bands: [{ upToGrams: 2000, priceMinor: 9000 }],
          surcharges: [{ code: "fuel", percent: 12 }],
        },
      ],
    });

    await repository.saveRateCard(card);

    expect(await repository.rateCardsFor(tenantId, carrierAccountId)).toEqual([card]);
  });

  it("returns the newest rate card first, so the current one is found soonest", async () => {
    const base = {
      tenantId,
      carrierAccountId,
      currency: "INR",
      lanes: [
        {
          origin: "BLR",
          destination: "HYD",
          service: "next_day",
          bands: [{ upToGrams: 2000, priceMinor: 9000 }],
          surcharges: [],
        },
      ],
    };
    await repository.saveRateCard(
      rateCard({ ...base, id: "01J8Z0T0000000000000000051", validFrom: new Date("2026-01-01T00:00:00.000Z") }),
    );
    await repository.saveRateCard(
      rateCard({ ...base, id: "01J8Z0T0000000000000000052", validFrom: new Date("2026-06-01T00:00:00.000Z") }),
    );

    expect((await repository.rateCardsFor(tenantId, carrierAccountId))[0]?.id).toBe(
      "01J8Z0T0000000000000000052",
    );
  });

  it("refuses a rate card that expires before it starts", async () => {
    await expect(
      repository.saveRateCard({
        id: "01J8Z0T0000000000000000053",
        tenantId,
        carrierAccountId,
        currency: "INR",
        validFrom: new Date("2026-06-01T00:00:00.000Z"),
        validUntil: new Date("2026-01-01T00:00:00.000Z"),
        lanes: [],
      }),
    ).rejects.toThrow();
  });

  it("round-trips an invoice with its lines", async () => {
    await repository.saveInvoice(invoice, [line]);

    expect(await repository.invoiceByNumber(tenantId, carrierAccountId, "INV-1")).toEqual(invoice);
    expect(await repository.linesFor(invoice.id)).toEqual([line]);
  });

  it("refuses the same invoice number twice from one carrier", async () => {
    await repository.saveInvoice(invoice, [line]);

    await expect(
      repository.saveInvoice({ ...invoice, id: "01J8Z0T0000000000000000021" }, []),
    ).rejects.toThrow();
  });

  it("allows the same number from a different carrier", async () => {
    await repository.saveCarrier({ ...carrier, id: "01J8Z0T0000000000000000011", name: "Other" });
    await repository.saveInvoice(invoice, [line]);

    await expect(
      repository.saveInvoice(
        {
          ...invoice,
          id: "01J8Z0T0000000000000000021",
          carrierAccountId: "01J8Z0T0000000000000000011",
        },
        [],
      ),
    ).resolves.toBeUndefined();
  });

  it("round-trips a settlement with its reasons", async () => {
    await repository.saveInvoice(invoice, [line]);
    await repository.saveSettlement(settlement);

    expect(await repository.settlementById(tenantId, settlement.id)).toEqual(settlement);
  });

  it("round-trips one that was disputed, agreed, and paid", async () => {
    await repository.saveInvoice(invoice, [line]);
    const paid: Settlement = {
      ...settlement,
      state: "paid",
      agreedMinor: 9000,
      note: "agreed at the contract price",
      paymentReference: "utr-1",
    };

    await repository.saveSettlement(paid);

    expect(await repository.settlementById(tenantId, settlement.id)).toEqual(paid);
  });

  it("refuses two settlements for the same invoice line", async () => {
    await repository.saveInvoice(invoice, [line]);
    await repository.saveSettlement(settlement);

    await expect(
      repository.saveSettlement({ ...settlement, id: "01J8Z0T0000000000000000041" }),
    ).rejects.toThrow();
  });

  it("lists the settlements for an invoice", async () => {
    await repository.saveInvoice(invoice, [line]);
    await repository.saveSettlement(settlement);

    expect(await repository.settlementsFor(tenantId, invoice.id)).toHaveLength(1);
    expect(await repository.settlementsFor("other", invoice.id)).toHaveLength(0);
  });

  it("hands out stream positions that never repeat", async () => {
    expect([
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "a"),
    ]).toEqual([1, 2]);
  });
});

describe("the cash ledger in the database", () => {
  const entry = {
    id: "01J8Z0T0000000000000000090:0",
    tenantId,
    kind: "collected" as const,
    account: "driver_float" as const,
    driverId: "d-1",
    deltaMinor: 50000,
    amountMinor: 50000,
    currency: "INR",
    reference: "c-1",
    at: new Date("2026-09-07T10:00:00.000Z"),
  };

  it("reads back what was posted to a driver", async () => {
    expect(await repository.saveCashMovement("t:collected:c-1", [entry])).toBe(true);

    const entries = await repository.cashEntriesFor(tenantId, { driverId: "d-1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ deltaMinor: 50000, reference: "c-1" });
  });

  it("claims a movement key once, so a repeated report banks nothing twice", async () => {
    await repository.saveCashMovement("t:collected:c-1", [entry]);

    expect(await repository.saveCashMovement("t:collected:c-1", [entry])).toBe(false);
    expect(await repository.cashEntriesFor(tenantId, { driverId: "d-1" })).toHaveLength(1);
  });

  it("leaves no entries behind when one of them cannot be written", async () => {
    const bad = { ...entry, id: `${entry.id}x`, kind: "written_off" as const };

    await expect(repository.saveCashMovement("t:mixed:c-1", [entry, bad])).rejects.toThrow();
    expect(await repository.cashEntriesFor(tenantId, { driverId: "d-1" })).toHaveLength(0);
  });

  it("keeps a driver's entries out of another driver's statement", async () => {
    await repository.saveCashMovement("t:collected:c-1", [entry]);

    expect(await repository.cashEntriesFor(tenantId, { driverId: "d-2" })).toEqual([]);
  });

  it("keeps one tenant's cash away from another", async () => {
    await repository.saveCashMovement("t:collected:c-1", [entry]);

    expect(await repository.cashEntriesFor("other", { driverId: "d-1" })).toEqual([]);
  });

  it("returns a merchant's payable entries in the order they happened", async () => {
    const payable = {
      ...entry,
      account: "merchant_payable" as const,
      merchantId: "m-1",
      driverId: undefined,
    };
    await repository.saveCashMovement("t:collected:c-1", [{ ...payable, id: "e-2" }]);
    await repository.saveCashMovement("t:remitted:p-1", [
      {
        ...payable,
        id: "e-3",
        kind: "remitted" as const,
        deltaMinor: -20000,
        amountMinor: 20000,
        reference: "p-1",
        at: new Date("2026-09-07T12:00:00.000Z"),
      },
    ]);

    const entries = await repository.cashEntriesFor(tenantId, { merchantId: "m-1" });
    expect(entries.map((e) => e.deltaMinor)).toEqual([50000, -20000]);
  });
});
