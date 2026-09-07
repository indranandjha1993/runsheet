import type { Envelope } from "@runsheet/kernel";
import type { RateCard } from "../domain/rate-card.js";
import type { CashEntry } from "../domain/cash-ledger.js";
import type { Evidence, InvoiceLine, Settlement } from "../domain/settlement.js";
import type {
  CarrierAccount,
  CashHolder,
  MoneyDeps,
  Clock,
  EventPublisher,
  EvidenceSource,
  Identifiers,
  Invoice,
  MoneyRepository,
} from "./ports.js";

function holds(entry: CashEntry, holder: CashHolder): boolean {
  return "driverId" in holder
    ? entry.account === "driver_float" && entry.driverId === holder.driverId
    : entry.account === "merchant_payable" && entry.merchantId === holder.merchantId;
}

/* eslint-disable max-lines-per-function -- one cohesive fake of a repository interface */
export function inMemoryMoney(): MoneyRepository {
  const carriers = new Map<string, CarrierAccount>();
  const cards: RateCard[] = [];
  const invoices = new Map<string, Invoice>();
  const lines = new Map<string, InvoiceLine[]>();
  const settlements = new Map<string, Settlement>();
  const sequences = new Map<string, number>();
  const movements = new Map<string, CashEntry[]>();
  const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

  return {
    saveCarrier: (account) => {
      carriers.set(key(account.tenantId, account.id), account);
      return Promise.resolve();
    },
    carrierById: (tenantId, id) => Promise.resolve(carriers.get(key(tenantId, id))),
    saveRateCard: (card) => {
      cards.push(card);
      return Promise.resolve();
    },
    rateCardsFor: (tenantId, carrierAccountId) =>
      Promise.resolve(
        cards.filter(
          (card) => card.tenantId === tenantId && card.carrierAccountId === carrierAccountId,
        ),
      ),
    saveInvoice: (invoice, invoiceLines) => {
      invoices.set(key(invoice.tenantId, `${invoice.carrierAccountId}:${invoice.number}`), invoice);
      lines.set(invoice.id, [...invoiceLines]);
      return Promise.resolve();
    },
    invoiceByNumber: (tenantId, carrierAccountId, number) =>
      Promise.resolve(invoices.get(key(tenantId, `${carrierAccountId}:${number}`))),
    linesFor: (invoiceId) => Promise.resolve(lines.get(invoiceId) ?? []),
    saveSettlement: (settlement) => {
      settlements.set(key(settlement.tenantId, settlement.id), settlement);
      return Promise.resolve();
    },
    settlementById: (tenantId, id) => Promise.resolve(settlements.get(key(tenantId, id))),
    invoicesFor: (tenantId) =>
      Promise.resolve([...invoices.values()].filter((invoice) => invoice.tenantId === tenantId)),
    settlementsInState: (tenantId, state) =>
      Promise.resolve(
        [...settlements.values()].filter(
          (settlement) => settlement.tenantId === tenantId && settlement.state === state,
        ),
      ),
    settlementsFor: (tenantId, invoiceId) =>
      Promise.resolve(
        [...settlements.values()].filter(
          (settlement) => settlement.tenantId === tenantId && settlement.invoiceId === invoiceId,
        ),
      ),
    saveCashMovement: (movementKey, entries) => {
      if (movements.has(movementKey)) return Promise.resolve(false);
      movements.set(movementKey, [...entries]);
      return Promise.resolve(true);
    },
    cashEntriesFor: (tenantId, holder) =>
      Promise.resolve(
        [...movements.values()]
          .flat()
          .filter((entry) => entry.tenantId === tenantId && holds(entry, holder)),
      ),
    nextSequence: (tenantId, aggregateId) => {
      const at = key(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
}

export function knownEvidence(evidence: Partial<Evidence> = {}): EvidenceSource {
  return {
    forConsignment: () =>
      Promise.resolve({
        expectedMinor: 10080,
        currency: "INR",
        shippedWeightGrams: 1200,
        deliveredAt: new Date("2026-09-07T15:00:00.000Z"),
        proofSatisfiesRequirement: true,
        ...evidence,
      }),
  };
}

export function noEvidence(): EvidenceSource {
  return { forConsignment: () => Promise.resolve(undefined) };
}

export interface Published {
  event: Envelope;
  payload: Record<string, unknown>;
  topic: string;
}

export function recordingPublisher(): EventPublisher & { published: Published[] } {
  const published: Published[] = [];
  return {
    published,
    publish: (event, payload, topic) => {
      published.push({ event, payload, topic });
      return Promise.resolve();
    },
  };
}

export function fixedClock(at: string): Clock {
  return { now: () => new Date(at) };
}

export function countingIds(): Identifiers {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `01J8Z0T00000000000000${String(n).padStart(5, "0")}`;
    },
  };
}

export function testDeps(): MoneyDeps & { publisher: ReturnType<typeof recordingPublisher> } {
  return {
    repository: inMemoryMoney(),
    evidence: knownEvidence(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
    tolerance: { amountMinor: 100, weightGrams: 100 },
    autoApproveBelowMinor: 5000,
  };
}
