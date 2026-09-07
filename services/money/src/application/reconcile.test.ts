import { beforeEach, describe, expect, it } from "vitest";
import { receiveInvoice, workSettlement } from "./reconcile.js";
import { rateCard } from "../domain/rate-card.js";
import {
  countingIds,
  fixedClock,
  inMemoryMoney,
  knownEvidence,
  noEvidence,
  recordingPublisher,
} from "./test-doubles.js";
import type { MoneyDeps } from "./ports.js";

const tenantId = "01J8Z0T0000000000000000002";
const carrierAccountId = "ca-1";

let deps: MoneyDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(async () => {
  deps = {
    repository: inMemoryMoney(),
    evidence: knownEvidence(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-30T10:00:00.000Z"),
    ids: countingIds(),
    tolerance: { amountMinor: 100, weightGrams: 50 },
    autoApproveBelowMinor: 500,
  };
  await deps.repository.saveCarrier({
    id: carrierAccountId,
    tenantId,
    name: "Regional Express",
    currency: "INR",
  });
});

const invoice = (over: Partial<Parameters<typeof receiveInvoice>[1]> = {}) => ({
  tenantId,
  carrierAccountId,
  number: "INV-1001",
  currency: "INR",
  lines: [{ consignmentId: "c-1", billedMinor: 10080, billedWeightGrams: 1200 }],
  ...over,
});

describe("receiving an invoice", () => {
  it("settles a line that matches the contract, without anyone touching it", async () => {
    const result = await receiveInvoice(deps, invoice());

    expect(result.settlements[0]?.state).toBe("approved");
    expect(result.settlements[0]?.autoApproved).toBe(true);
  });

  it("holds an overcharge for a person and says why", async () => {
    const result = await receiveInvoice(
      deps,
      invoice({ lines: [{ consignmentId: "c-1", billedMinor: 20000, billedWeightGrams: 1200 }] }),
    );

    expect(result.settlements[0]?.state).toBe("mismatched");
    expect(result.settlements[0]?.reasons).toContain("billed_above_contract");
    expect(result.settlements[0]?.varianceMinor).toBe(9920);
  });

  it("holds a line the carrier billed heavier than the parcel shipped", async () => {
    const result = await receiveInvoice(
      deps,
      invoice({ lines: [{ consignmentId: "c-1", billedMinor: 10080, billedWeightGrams: 5000 }] }),
    );

    expect(result.settlements[0]?.reasons).toContain("billed_weight_above_shipped");
  });

  it("holds a line with no proof of delivery, because no proof means no payment", async () => {
    deps = { ...deps, evidence: knownEvidence({ deliveredAt: undefined }) };

    const result = await receiveInvoice(deps, invoice());

    expect(result.settlements[0]?.state).toBe("missing_evidence");
  });

  it("holds a line for a consignment nothing is known about", async () => {
    deps = { ...deps, evidence: noEvidence() };

    const result = await receiveInvoice(deps, invoice());

    expect(result.settlements[0]?.reasons).toContain("consignment_unknown");
  });

  it("does not approve a matched line above the threshold on its own", async () => {
    deps = { ...deps, autoApproveBelowMinor: 10 };

    const result = await receiveInvoice(
      deps,
      invoice({ lines: [{ consignmentId: "c-1", billedMinor: 10160, billedWeightGrams: 1200 }] }),
    );

    expect(result.settlements[0]?.state).toBe("matched");
    expect(result.settlements[0]?.autoApproved).toBe(false);
  });

  it("returns what it decided before when a carrier resends the same invoice", async () => {
    const first = await receiveInvoice(deps, invoice());

    const again = await receiveInvoice(deps, invoice());

    expect(again.alreadyReceived).toBe(true);
    expect(again.invoiceId).toBe(first.invoiceId);
    expect(again.settlements).toHaveLength(1);
  });

  it("announces what it received and how it turned out", async () => {
    await receiveInvoice(
      deps,
      invoice({
        lines: [
          { consignmentId: "c-1", billedMinor: 10080, billedWeightGrams: 1200 },
          { consignmentId: "c-2", billedMinor: 20000, billedWeightGrams: 1200 },
        ],
      }),
    );

    expect(deps.publisher.published[0]?.payload).toMatchObject({
      lines: 2,
      outcomes: { approved: 1, mismatched: 1 },
    });
  });

  it("refuses an invoice from a carrier nobody set up", async () => {
    await expect(receiveInvoice(deps, invoice({ carrierAccountId: "nope" }))).rejects.toThrow(
      "no carrier account with that identifier",
    );
  });

  it("refuses an invoice with no lines", async () => {
    await expect(receiveInvoice(deps, invoice({ lines: [] }))).rejects.toThrow(
      "an invoice needs at least one line",
    );
  });
});

describe("working a settlement", () => {
  const mismatched = async (): Promise<string> => {
    const result = await receiveInvoice(
      deps,
      invoice({ lines: [{ consignmentId: "c-1", billedMinor: 20000, billedWeightGrams: 1200 }] }),
    );
    return result.settlements[0]?.id ?? "";
  };

  it("disputes it, settles on an agreed amount, and pays that", async () => {
    const id = await mismatched();

    await workSettlement(deps, {
      tenantId,
      settlementId: id,
      event: { type: "disputed", by: "u1", note: "billed above the contract" },
    });
    const agreed = await workSettlement(deps, {
      tenantId,
      settlementId: id,
      event: { type: "dispute_resolved", agreedMinor: 10080, by: "carrier" },
    });
    const paid = await workSettlement(deps, {
      tenantId,
      settlementId: id,
      event: { type: "paid", reference: "utr-1" },
    });

    expect(agreed.agreedMinor).toBe(10080);
    expect(paid.state).toBe("paid");
    expect(paid.paymentReference).toBe("utr-1");
  });

  it("refuses a step the state machine forbids", async () => {
    const id = await mismatched();

    await expect(
      workSettlement(deps, { tenantId, settlementId: id, event: { type: "paid", reference: "x" } }),
    ).rejects.toThrow(/cannot be paid/);
  });

  it("writes off a line whose evidence never arrived", async () => {
    deps = { ...deps, evidence: noEvidence() };
    const result = await receiveInvoice(deps, invoice());

    const written = await workSettlement(deps, {
      tenantId,
      settlementId: result.settlements[0]?.id ?? "",
      event: { type: "written_off", by: "u1", note: "carrier could not produce proof" },
    });

    expect(written.state).toBe("written_off");
  });

  it("announces each step so the trail is complete", async () => {
    const id = await mismatched();
    deps.publisher.published.length = 0;

    await workSettlement(deps, {
      tenantId,
      settlementId: id,
      event: { type: "disputed", by: "u1", note: "checking" },
    });

    expect(deps.publisher.published[0]?.event.type).toBe("settlement.disputed");
  });

  it("reports a settlement nobody has", async () => {
    await expect(
      workSettlement(deps, {
        tenantId,
        settlementId: "nope",
        event: { type: "approved", by: "u", automatic: false },
      }),
    ).rejects.toThrow("no settlement with that identifier");
  });

  it("keeps one tenant from working another's settlement", async () => {
    const id = await mismatched();

    await expect(
      workSettlement(deps, {
        tenantId: "other",
        settlementId: id,
        event: { type: "disputed", by: "u", note: "x" },
      }),
    ).rejects.toThrow("no settlement with that identifier");
  });
});

describe("pricing a line from the contract when nothing else knows what it should cost", () => {
  const lane = {
    origin: "BLR",
    destination: "HYD",
    service: "next_day",
    bands: [{ upToGrams: 2000, priceMinor: 9000 }],
    surcharges: [{ code: "fuel", percent: 12 }],
  };

  const withCard = async (validFrom = "2026-01-01T00:00:00.000Z"): Promise<void> => {
    await deps.repository.saveRateCard(
      rateCard({
        id: "rc-1",
        tenantId,
        carrierAccountId,
        currency: "INR",
        validFrom: new Date(validFrom),
        lanes: [lane],
      }),
    );
  };

  const unpriced = {
    expectedMinor: 0,
    origin: "BLR",
    destination: "HYD",
    service: "next_day",
  };

  it("prices the line from the rate card in force and matches against that", async () => {
    await withCard();
    deps = { ...deps, evidence: knownEvidence(unpriced) };

    const result = await receiveInvoice(deps, invoice());

    expect(result.settlements[0]?.state).toBe("approved");
  });

  it("flags an overcharge measured against the contract price", async () => {
    await withCard();
    deps = { ...deps, evidence: knownEvidence(unpriced) };

    const result = await receiveInvoice(
      deps,
      invoice({ lines: [{ consignmentId: "c-1", billedMinor: 20000, billedWeightGrams: 1200 }] }),
    );

    expect(result.settlements[0]?.reasons).toContain("billed_above_contract");
  });

  it("does not invent a price when no card covers the lane", async () => {
    await withCard();
    deps = { ...deps, evidence: knownEvidence({ ...unpriced, destination: "DEL" }) };

    const result = await receiveInvoice(deps, invoice());

    expect(result.settlements[0]?.reasons).toContain("billed_above_contract");
  });

  it("uses the card in force when the parcel moved, not whichever is current", async () => {
    await withCard("2027-01-01T00:00:00.000Z");
    deps = { ...deps, evidence: knownEvidence(unpriced) };

    const result = await receiveInvoice(deps, invoice());

    expect(result.settlements[0]?.state).not.toBe("approved");
  });

  it("prices from delivery time when the card has no card at all", async () => {
    deps = { ...deps, evidence: knownEvidence(unpriced) };

    const result = await receiveInvoice(deps, invoice());

    expect(result.settlements[0]?.reasons).toContain("billed_above_contract");
  });
});

describe("when the platform knows too little to price a line", () => {
  it("leaves the price alone rather than guessing from a partial lane", async () => {
    await deps.repository.saveRateCard(
      rateCard({
        id: "rc-2",
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
            surcharges: [],
          },
        ],
      }),
    );
    deps = { ...deps, evidence: knownEvidence({ expectedMinor: 0, origin: "BLR" }) };

    const result = await receiveInvoice(deps, invoice());

    expect(result.settlements[0]?.reasons).toContain("billed_above_contract");
  });
});
