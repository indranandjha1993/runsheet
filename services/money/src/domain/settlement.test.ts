import { describe, expect, it } from "vitest";
import { applyToSettlement, match, type Evidence, type InvoiceLine } from "./settlement.js";

const line: InvoiceLine = {
  id: "il-1",
  invoiceId: "inv-1",
  consignmentId: "c-1",
  billedMinor: 10080,
  currency: "INR",
  billedWeightGrams: 1200,
};

const evidence: Evidence = {
  expectedMinor: 10080,
  currency: "INR",
  shippedWeightGrams: 1200,
  deliveredAt: new Date("2026-09-07T15:00:00.000Z"),
  proofSatisfiesRequirement: true,
};

const tolerance = { amountMinor: 100, weightGrams: 50 };

describe("matching an invoice line against what happened", () => {
  it("matches when the carrier billed what the contract says", () => {
    const result = match(line, evidence, tolerance);

    expect(result.outcome).toBe("matched");
    expect(result.varianceMinor).toBe(0);
  });

  it("matches a difference inside the tolerance rather than disputing pennies", () => {
    const result = match({ ...line, billedMinor: 10130 }, evidence, tolerance);

    expect(result.outcome).toBe("matched");
    expect(result.varianceMinor).toBe(50);
  });

  it("flags an overcharge beyond the tolerance and says by how much", () => {
    const result = match({ ...line, billedMinor: 12000 }, evidence, tolerance);

    expect(result.outcome).toBe("mismatched");
    expect(result.varianceMinor).toBe(1920);
    expect(result.reasons).toContain("billed_above_contract");
  });

  it("flags an undercharge too, because a carrier who bills low today invoices twice later", () => {
    const result = match({ ...line, billedMinor: 8000 }, evidence, tolerance);

    expect(result.outcome).toBe("mismatched");
    expect(result.reasons).toContain("billed_below_contract");
  });

  it("flags a weight the carrier inflated, the commonest dispute in parcel", () => {
    const result = match({ ...line, billedWeightGrams: 2500 }, evidence, tolerance);

    expect(result.reasons).toContain("billed_weight_above_shipped");
  });

  it("holds a line with no proof of delivery, because no proof means no payment", () => {
    const result = match(line, { ...evidence, deliveredAt: undefined }, tolerance);

    expect(result.outcome).toBe("missing_evidence");
    expect(result.reasons).toContain("no_delivery_recorded");
  });

  it("holds a line whose proof fell short of what was required", () => {
    const result = match(line, { ...evidence, proofSatisfiesRequirement: false }, tolerance);

    expect(result.outcome).toBe("missing_evidence");
    expect(result.reasons).toContain("proof_insufficient");
  });

  it("holds a line for a consignment nothing is known about", () => {
    const result = match(line, undefined, tolerance);

    expect(result.outcome).toBe("missing_evidence");
    expect(result.reasons).toContain("consignment_unknown");
  });

  it("refuses to compare amounts in different currencies", () => {
    const result = match(line, { ...evidence, currency: "AED" }, tolerance);

    expect(result.outcome).toBe("mismatched");
    expect(result.reasons).toContain("currency_mismatch");
  });

  it("reports every problem at once, not just the first", () => {
    const result = match(
      { ...line, billedMinor: 20000, billedWeightGrams: 5000 },
      evidence,
      tolerance,
    );

    expect(result.reasons).toEqual(
      expect.arrayContaining(["billed_above_contract", "billed_weight_above_shipped"]),
    );
  });
});

describe("working a settlement", () => {
  const settled = (outcome: "matched" | "mismatched" | "missing_evidence") => ({
    id: "s-1",
    tenantId: "t",
    lineId: line.id,
    invoiceId: line.invoiceId,
    state: outcome,
    varianceMinor: 0,
    reasons: [] as string[],
    autoApproved: false,
  });

  it("approves a matched line automatically below the threshold", () => {
    const approved = applyToSettlement(settled("matched"), {
      type: "approved",
      by: "policy:settlement",
      automatic: true,
    });

    expect(approved.state).toBe("approved");
    expect(approved.autoApproved).toBe(true);
  });

  it("will not approve a line that did not match", () => {
    expect(() =>
      applyToSettlement(settled("mismatched"), { type: "approved", by: "u1", automatic: false }),
    ).toThrow("a settlement that is mismatched cannot be approved");
  });

  it("disputes a mismatch and later records what was agreed", () => {
    const disputed = applyToSettlement(settled("mismatched"), {
      type: "disputed",
      by: "u1",
      note: "billed weight exceeds shipped",
    });
    const resolved = applyToSettlement(disputed, {
      type: "dispute_resolved",
      agreedMinor: 9000,
      by: "carrier",
    });

    expect(resolved.state).toBe("approved");
    expect(resolved.agreedMinor).toBe(9000);
  });

  it("records a dispute the carrier won, so the original stands", () => {
    const disputed = applyToSettlement(settled("mismatched"), {
      type: "disputed",
      by: "u1",
      note: "checking",
    });

    const rejected = applyToSettlement(disputed, { type: "dispute_rejected", by: "carrier" });

    expect(rejected.state).toBe("approved");
  });

  it("insists on a note when disputing, because the carrier has to be told why", () => {
    expect(() =>
      applyToSettlement(settled("mismatched"), { type: "disputed", by: "u1", note: "" }),
    ).toThrow("a dispute needs a note");
  });

  it("insists on a note when writing a line off, because someone signs for that money", () => {
    expect(() =>
      applyToSettlement(settled("missing_evidence"), { type: "written_off", by: "u1", note: " " }),
    ).toThrow("writing a line off needs a note");
  });

  it("pays only what was approved", () => {
    const approved = applyToSettlement(settled("matched"), {
      type: "approved",
      by: "u1",
      automatic: false,
    });

    expect(applyToSettlement(approved, { type: "paid", reference: "utr-1" }).state).toBe("paid");
  });

  it("will not pay something never approved", () => {
    expect(() => applyToSettlement(settled("matched"), { type: "paid", reference: "x" })).toThrow(
      "a settlement that is matched cannot be paid",
    );
  });

  it("writes off a line whose evidence never arrived", () => {
    const written = applyToSettlement(settled("missing_evidence"), {
      type: "written_off",
      by: "u1",
      note: "carrier could not produce proof",
    });

    expect(written.state).toBe("written_off");
  });
});
