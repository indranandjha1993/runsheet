import type { Envelope } from "@runsheet/kernel";
import type { Evidence, InvoiceLine, Settlement, SettlementState } from "../domain/settlement.js";
import type { RateCard } from "../domain/rate-card.js";
import type { CashEntry } from "../domain/cash-ledger.js";

export interface CarrierAccount {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly currency: string;
}

export interface Invoice {
  readonly id: string;
  readonly tenantId: string;
  readonly carrierAccountId: string;
  readonly number: string;
  readonly currency: string;
}

export interface MoneyRepository {
  saveCarrier(account: CarrierAccount): Promise<void>;
  carrierById(tenantId: string, id: string): Promise<CarrierAccount | undefined>;
  saveRateCard(card: RateCard): Promise<void>;
  rateCardsFor(tenantId: string, carrierAccountId: string): Promise<RateCard[]>;
  saveInvoice(invoice: Invoice, lines: readonly InvoiceLine[]): Promise<void>;
  invoiceByNumber(
    tenantId: string,
    carrierAccountId: string,
    number: string,
  ): Promise<Invoice | undefined>;
  linesFor(invoiceId: string): Promise<InvoiceLine[]>;
  saveSettlement(settlement: Settlement): Promise<void>;
  settlementById(tenantId: string, id: string): Promise<Settlement | undefined>;
  settlementsFor(tenantId: string, invoiceId: string): Promise<Settlement[]>;
  invoicesFor(tenantId: string): Promise<Invoice[]>;
  settlementsInState(tenantId: string, state: SettlementState): Promise<Settlement[]>;
  saveCashMovement(key: string, entries: readonly CashEntry[]): Promise<boolean>;
  cashEntriesFor(tenantId: string, holder: CashHolder): Promise<CashEntry[]>;
  nextSequence(tenantId: string, aggregateId: string): Promise<number>;
}

// A statement is read for one party at a time. Asking for both at once would return two
// unrelated balances that nobody can act on together.
export type CashHolder = { readonly driverId: string } | { readonly merchantId: string };

// What the rest of the platform knows about a consignment. The money service never reads
// another service's database; it asks.
export interface EvidenceSource {
  forConsignment(tenantId: string, consignmentId: string): Promise<Evidence | undefined>;
}

export interface EventPublisher {
  publish(event: Envelope, payload: Record<string, unknown>, topic: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Identifiers {
  next(): string;
}

export interface MoneyDeps {
  readonly repository: MoneyRepository;
  readonly evidence: EvidenceSource;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
  readonly tolerance: { readonly amountMinor: number; readonly weightGrams: number };
  readonly autoApproveBelowMinor: number;
}
