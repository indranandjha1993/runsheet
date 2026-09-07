import { priceFor, type RateCard } from "../domain/rate-card.js";
import {
  applyToSettlement,
  match,
  type Evidence,
  type InvoiceLine,
  type Settlement,
  type SettlementEvent,
} from "../domain/settlement.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { Invoice, MoneyDeps } from "./ports.js";

export interface ReceiveInvoiceCommand {
  readonly tenantId: string;
  readonly carrierAccountId: string;
  readonly number: string;
  readonly currency: string;
  readonly lines: readonly {
    readonly consignmentId: string;
    readonly billedMinor: number;
    readonly billedWeightGrams: number;
  }[];
}

async function record(
  deps: MoneyDeps,
  command: ReceiveInvoiceCommand,
): Promise<{ invoice: Invoice; lines: InvoiceLine[] }> {
  const carrier = await deps.repository.carrierById(command.tenantId, command.carrierAccountId);
  if (carrier === undefined) {
    throw new DomainError("not_found", "no carrier account with that identifier");
  }
  if (command.lines.length === 0) {
    throw new DomainError("invalid_input", "an invoice needs at least one line");
  }

  const invoice: Invoice = {
    id: deps.ids.next(),
    tenantId: command.tenantId,
    carrierAccountId: command.carrierAccountId,
    number: command.number,
    currency: command.currency,
  };
  const lines: InvoiceLine[] = command.lines.map((line) => ({
    id: deps.ids.next(),
    invoiceId: invoice.id,
    consignmentId: line.consignmentId,
    billedMinor: line.billedMinor,
    currency: command.currency,
    billedWeightGrams: line.billedWeightGrams,
  }));

  await deps.repository.saveInvoice(invoice, lines);
  return { invoice, lines };
}

async function settleEach(
  deps: MoneyDeps,
  command: ReceiveInvoiceCommand,
  lines: readonly InvoiceLine[],
): Promise<Settlement[]> {
  const cards = await deps.repository.rateCardsFor(command.tenantId, command.carrierAccountId);
  const settlements: Settlement[] = [];

  for (const line of lines) {
    const evidence = await evidenceWithContract(deps, cards, command.tenantId, line);
    const decided = autoApprove(deps, settleLine(deps, command.tenantId, line, evidence));
    await deps.repository.saveSettlement(decided);
    settlements.push(decided);
  }
  return settlements;
}

export interface ReconcileResult {
  readonly invoiceId: string;
  readonly settlements: readonly Settlement[];
  readonly alreadyReceived: boolean;
}

function summarise(settlements: readonly Settlement[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const settlement of settlements) {
    counts[settlement.state] = (counts[settlement.state] ?? 0) + 1;
  }
  return counts;
}

function settleLine(
  deps: MoneyDeps,
  tenantId: string,
  line: InvoiceLine,
  evidence: Evidence | undefined,
): Settlement {
  const result = match(line, evidence, deps.tolerance);
  return {
    id: deps.ids.next(),
    tenantId,
    lineId: line.id,
    invoiceId: line.invoiceId,
    state: result.outcome,
    varianceMinor: result.varianceMinor,
    reasons: result.reasons,
    autoApproved: false,
  };
}

// A carrier resending an invoice must not create a second set of settlements. The invoice number
// from that carrier is the identity, and the second arrival returns what was decided the first
// time.
export async function receiveInvoice(
  deps: MoneyDeps,
  command: ReceiveInvoiceCommand,
): Promise<ReconcileResult> {
  const existing = await deps.repository.invoiceByNumber(
    command.tenantId,
    command.carrierAccountId,
    command.number,
  );
  if (existing !== undefined) {
    return {
      invoiceId: existing.id,
      settlements: await deps.repository.settlementsFor(command.tenantId, existing.id),
      alreadyReceived: true,
    };
  }

  const { invoice, lines } = await record(deps, command);
  const settlements = await settleEach(deps, command, lines);

  await announce(deps, {
    tenantId: command.tenantId,
    aggregateType: "invoice",
    aggregateId: invoice.id,
    type: "invoice.received",
    topic: "money",
    payload: {
      carrier_account_id: command.carrierAccountId,
      number: command.number,
      lines: lines.length,
      outcomes: summarise(settlements),
    },
  });

  return { invoiceId: invoice.id, settlements, alreadyReceived: false };
}

// The contract price comes from the rate card in force when the parcel moved, not from whichever
// card happens to be current now.
async function evidenceWithContract(
  deps: MoneyDeps,
  cards: readonly RateCard[],
  tenantId: string,
  line: InvoiceLine,
): Promise<Evidence | undefined> {
  const known = await deps.evidence.forConsignment(tenantId, line.consignmentId);
  if (known === undefined) return undefined;
  if (known.expectedMinor > 0) return known;

  const { origin, destination, service } = known;
  if (origin === undefined || destination === undefined || service === undefined) return known;

  for (const card of cards) {
    const priced = priceFor(card, {
      origin,
      destination,
      service,
      weightGrams: known.shippedWeightGrams,
      at: known.deliveredAt ?? deps.clock.now(),
    });
    if (priced !== undefined) {
      return { ...known, expectedMinor: priced.totalMinor, currency: priced.currency };
    }
  }
  return known;
}

// Small, clean lines settle themselves. Anything above the threshold, or anything that did not
// match, waits for a person. That threshold is the whole trust question in one number.
function autoApprove(deps: MoneyDeps, settlement: Settlement): Settlement {
  if (settlement.state !== "matched") return settlement;
  if (Math.abs(settlement.varianceMinor) > deps.autoApproveBelowMinor) return settlement;
  return applyToSettlement(settlement, {
    type: "approved",
    by: "policy:settlement",
    automatic: true,
  });
}

export interface WorkSettlementCommand {
  readonly tenantId: string;
  readonly settlementId: string;
  readonly event: SettlementEvent;
}

export async function workSettlement(
  deps: MoneyDeps,
  command: WorkSettlementCommand,
): Promise<Settlement> {
  const found = await deps.repository.settlementById(command.tenantId, command.settlementId);
  if (found === undefined) {
    throw new DomainError("not_found", "no settlement with that identifier");
  }

  const next = applyToSettlement(found, command.event);
  await deps.repository.saveSettlement(next);

  await announce(deps, {
    tenantId: next.tenantId,
    aggregateType: "settlement",
    aggregateId: next.id,
    type: `settlement.${command.event.type}`,
    topic: "money",
    payload: {
      state: next.state,
      variance_minor: next.varianceMinor,
      ...(next.agreedMinor === undefined ? {} : { agreed_minor: next.agreedMinor }),
    },
  });

  return next;
}
