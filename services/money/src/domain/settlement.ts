import { DomainError } from "./errors.js";

export interface InvoiceLine {
  readonly id: string;
  readonly invoiceId: string;
  readonly consignmentId: string;
  readonly billedMinor: number;
  readonly currency: string;
  readonly billedWeightGrams: number;
}

// What actually happened, gathered from the rest of the platform. This is the other three
// corners of the four-way match: the contract, the delivery, and the proof.
export interface Evidence {
  readonly expectedMinor: number;
  readonly currency: string;
  readonly shippedWeightGrams: number;
  readonly deliveredAt?: Date | undefined;
  readonly proofSatisfiesRequirement: boolean;
  readonly origin?: string;
  readonly destination?: string;
  readonly service?: string;
}

export interface Tolerance {
  readonly amountMinor: number;
  readonly weightGrams: number;
}

export type MatchOutcome = "matched" | "mismatched" | "missing_evidence";

export interface MatchResult {
  readonly outcome: MatchOutcome;
  readonly varianceMinor: number;
  readonly reasons: readonly string[];
}

function evidenceProblems(evidence: Evidence | undefined): string[] {
  if (evidence === undefined) return ["consignment_unknown"];

  const problems: string[] = [];
  if (evidence.deliveredAt === undefined) problems.push("no_delivery_recorded");
  if (!evidence.proofSatisfiesRequirement) problems.push("proof_insufficient");
  return problems;
}

function billingProblems(
  line: InvoiceLine,
  evidence: Evidence,
  tolerance: Tolerance,
): { reasons: string[]; varianceMinor: number } {
  const reasons: string[] = [];
  const varianceMinor = line.billedMinor - evidence.expectedMinor;

  if (line.currency !== evidence.currency) reasons.push("currency_mismatch");
  if (varianceMinor > tolerance.amountMinor) reasons.push("billed_above_contract");
  if (-varianceMinor > tolerance.amountMinor) reasons.push("billed_below_contract");
  if (line.billedWeightGrams - evidence.shippedWeightGrams > tolerance.weightGrams) {
    reasons.push("billed_weight_above_shipped");
  }

  return { reasons, varianceMinor };
}

// The four-way match: what was ordered, what the contract says it costs, what actually happened
// in the field, and what the carrier billed. A line only settles when all four agree.
export function match(
  line: InvoiceLine,
  evidence: Evidence | undefined,
  tolerance: Tolerance,
): MatchResult {
  const missing = evidenceProblems(evidence);
  if (evidence === undefined || missing.length > 0) {
    return { outcome: "missing_evidence", varianceMinor: 0, reasons: missing };
  }

  const billing = billingProblems(line, evidence, tolerance);
  return {
    outcome: billing.reasons.length === 0 ? "matched" : "mismatched",
    varianceMinor: billing.varianceMinor,
    reasons: billing.reasons,
  };
}

export type SettlementState =
  MatchOutcome | "disputed" | "approved" | "paid" | "rejected" | "written_off";

export interface Settlement {
  readonly id: string;
  readonly tenantId: string;
  readonly lineId: string;
  readonly invoiceId: string;
  readonly state: SettlementState;
  readonly varianceMinor: number;
  readonly reasons: readonly string[];
  readonly autoApproved: boolean;
  readonly agreedMinor?: number;
  readonly note?: string;
  readonly paymentReference?: string;
}

export type SettlementEvent =
  | { type: "approved"; by: string; automatic: boolean }
  | { type: "disputed"; by: string; note: string }
  | { type: "dispute_resolved"; agreedMinor: number; by: string }
  | { type: "dispute_rejected"; by: string }
  | { type: "paid"; reference: string }
  | { type: "written_off"; by: string; note: string };

const ALLOWED: Record<SettlementEvent["type"], readonly SettlementState[]> = {
  approved: ["matched"],
  disputed: ["mismatched"],
  dispute_resolved: ["disputed"],
  dispute_rejected: ["disputed"],
  paid: ["approved"],
  written_off: ["missing_evidence", "mismatched", "disputed"],
};

const READABLE: Record<SettlementEvent["type"], string> = {
  approved: "be approved",
  disputed: "be disputed",
  dispute_resolved: "have its dispute resolved",
  dispute_rejected: "have its dispute rejected",
  paid: "be paid",
  written_off: "be written off",
};

type Handlers = {
  [K in SettlementEvent["type"]]: (
    settlement: Settlement,
    event: Extract<SettlementEvent, { type: K }>,
  ) => Settlement;
};

const HANDLERS: Handlers = {
  approved: (settlement, event) => ({
    ...settlement,
    state: "approved",
    autoApproved: event.automatic,
  }),
  disputed: (settlement, event) => ({ ...settlement, state: "disputed", note: event.note }),
  dispute_resolved: (settlement, event) => ({
    ...settlement,
    state: "approved",
    agreedMinor: event.agreedMinor,
  }),
  dispute_rejected: (settlement) => ({ ...settlement, state: "approved" }),
  paid: (settlement, event) => ({
    ...settlement,
    state: "paid",
    paymentReference: event.reference,
  }),
  written_off: (settlement, event) => ({
    ...settlement,
    state: "written_off",
    note: event.note,
  }),
};

function assertNoted(event: SettlementEvent): void {
  if (event.type === "disputed" && event.note.trim() === "") {
    throw new DomainError("invalid_input", "a dispute needs a note");
  }
  if (event.type === "written_off" && event.note.trim() === "") {
    throw new DomainError("invalid_input", "writing a line off needs a note");
  }
}

export function applyToSettlement(settlement: Settlement, event: SettlementEvent): Settlement {
  if (!ALLOWED[event.type].includes(settlement.state)) {
    throw new DomainError(
      "transition_not_allowed",
      `a settlement that is ${settlement.state} cannot ${READABLE[event.type]}`,
    );
  }
  assertNoted(event);
  const handler = HANDLERS[event.type] as (s: Settlement, e: SettlementEvent) => Settlement;
  return handler(settlement, event);
}
