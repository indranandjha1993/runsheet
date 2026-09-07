import type { Pool, PoolClient } from "pg";
import type { Lane, RateCard } from "../domain/rate-card.js";
import type { InvoiceLine, Settlement, SettlementState } from "../domain/settlement.js";
import type { CashHolder, MoneyRepository } from "../application/ports.js";
import type { CashAccount, CashEntry, MovementKind } from "../domain/cash-ledger.js";

interface CarrierRow {
  id: string;
  tenant_id: string;
  name: string;
  currency: string;
}

interface CardRow {
  id: string;
  tenant_id: string;
  carrier_account_id: string;
  currency: string;
  valid_from: Date;
  valid_until: Date | null;
  lanes: Lane[];
}

interface InvoiceRow {
  id: string;
  tenant_id: string;
  carrier_account_id: string;
  number: string;
  currency: string;
}

interface LineRow {
  id: string;
  invoice_id: string;
  consignment_id: string;
  billed_minor: string;
  currency: string;
  billed_weight_grams: number;
}

interface SettlementRow {
  id: string;
  tenant_id: string;
  line_id: string;
  invoice_id: string;
  state: SettlementState;
  variance_minor: string;
  reasons: string[];
  auto_approved: boolean;
  agreed_minor: string | null;
  note: string | null;
  payment_reference: string | null;
}

const orNull = <T>(value: T | undefined): T | null => value ?? null;

function toCard(row: CardRow): RateCard {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    carrierAccountId: row.carrier_account_id,
    currency: row.currency,
    validFrom: row.valid_from,
    lanes: row.lanes,
    ...(row.valid_until === null ? {} : { validUntil: row.valid_until }),
  };
}

function toLine(row: LineRow): InvoiceLine {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    consignmentId: row.consignment_id,
    billedMinor: Number(row.billed_minor),
    currency: row.currency,
    billedWeightGrams: row.billed_weight_grams,
  };
}

function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    lineId: row.line_id,
    invoiceId: row.invoice_id,
    state: row.state,
    varianceMinor: Number(row.variance_minor),
    reasons: row.reasons,
    autoApproved: row.auto_approved,
    ...(row.agreed_minor === null ? {} : { agreedMinor: Number(row.agreed_minor) }),
    ...(row.note === null ? {} : { note: row.note }),
    ...(row.payment_reference === null ? {} : { paymentReference: row.payment_reference }),
  };
}

function carriers(pool: Pool): Pick<MoneyRepository, "saveCarrier" | "carrierById"> {
  return {
    async saveCarrier(account) {
      await pool.query(
        `INSERT INTO carrier_accounts (id, tenant_id, name, currency) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [account.id, account.tenantId, account.name, account.currency],
      );
    },
    async carrierById(tenantId, id) {
      const result = await pool.query<CarrierRow>(
        "SELECT * FROM carrier_accounts WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : { id: row.id, tenantId: row.tenant_id, name: row.name, currency: row.currency };
    },
  };
}

function cards(pool: Pool): Pick<MoneyRepository, "saveRateCard" | "rateCardsFor"> {
  return {
    async saveRateCard(card) {
      await pool.query(
        `INSERT INTO rate_cards (id, tenant_id, carrier_account_id, currency, valid_from,
           valid_until, lanes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          card.id,
          card.tenantId,
          card.carrierAccountId,
          card.currency,
          card.validFrom,
          orNull(card.validUntil),
          JSON.stringify(card.lanes),
        ],
      );
    },
    async rateCardsFor(tenantId, carrierAccountId) {
      const result = await pool.query<CardRow>(
        `SELECT * FROM rate_cards WHERE tenant_id = $1 AND carrier_account_id = $2
         ORDER BY valid_from DESC`,
        [tenantId, carrierAccountId],
      );
      return result.rows.map(toCard);
    },
  };
}

async function writeLine(pool: Pool, line: InvoiceLine): Promise<void> {
  await pool.query(
    `INSERT INTO invoice_lines (id, invoice_id, consignment_id, billed_minor, currency,
       billed_weight_grams) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      line.id,
      line.invoiceId,
      line.consignmentId,
      line.billedMinor,
      line.currency,
      line.billedWeightGrams,
    ],
  );
}

function invoices(
  pool: Pool,
): Pick<MoneyRepository, "saveInvoice" | "invoiceByNumber" | "linesFor"> {
  return {
    async saveInvoice(invoice, lines) {
      await pool.query(
        `INSERT INTO invoices (id, tenant_id, carrier_account_id, number, currency)
         VALUES ($1,$2,$3,$4,$5)`,
        [invoice.id, invoice.tenantId, invoice.carrierAccountId, invoice.number, invoice.currency],
      );
      for (const line of lines) await writeLine(pool, line);
    },
    async invoiceByNumber(tenantId, carrierAccountId, number) {
      const result = await pool.query<InvoiceRow>(
        `SELECT * FROM invoices
         WHERE tenant_id = $1 AND carrier_account_id = $2 AND number = $3`,
        [tenantId, carrierAccountId, number],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : {
            id: row.id,
            tenantId: row.tenant_id,
            carrierAccountId: row.carrier_account_id,
            number: row.number,
            currency: row.currency,
          };
    },
    async linesFor(invoiceId) {
      const result = await pool.query<LineRow>(
        "SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY id",
        [invoiceId],
      );
      return result.rows.map(toLine);
    },
  };
}

async function writeSettlement(pool: Pool, settlement: Settlement): Promise<void> {
  await pool.query(
    `INSERT INTO settlements (id, tenant_id, line_id, invoice_id, state, variance_minor,
       reasons, auto_approved, agreed_minor, note, payment_reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state,
       agreed_minor = EXCLUDED.agreed_minor, note = EXCLUDED.note,
       auto_approved = EXCLUDED.auto_approved,
       payment_reference = EXCLUDED.payment_reference, updated_at = now()`,
    [
      settlement.id,
      settlement.tenantId,
      settlement.lineId,
      settlement.invoiceId,
      settlement.state,
      settlement.varianceMinor,
      settlement.reasons,
      settlement.autoApproved,
      orNull(settlement.agreedMinor),
      orNull(settlement.note),
      orNull(settlement.paymentReference),
    ],
  );
}

function settlements(
  pool: Pool,
): Pick<MoneyRepository, "saveSettlement" | "settlementById" | "settlementsFor"> {
  return {
    async saveSettlement(settlement) {
      await writeSettlement(pool, settlement);
    },

    async settlementById(tenantId, id) {
      const result = await pool.query<SettlementRow>(
        "SELECT * FROM settlements WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toSettlement(row);
    },

    async settlementsFor(tenantId, invoiceId) {
      const result = await pool.query<SettlementRow>(
        "SELECT * FROM settlements WHERE tenant_id = $1 AND invoice_id = $2 ORDER BY id",
        [tenantId, invoiceId],
      );
      return result.rows.map(toSettlement);
    },
  };
}

function streams(pool: Pool): Pick<MoneyRepository, "nextSequence"> {
  return {
    async nextSequence(tenantId, aggregateId) {
      const result = await pool.query<{ last_sequence: string }>(
        `INSERT INTO aggregate_streams (tenant_id, aggregate_id, last_sequence)
         VALUES ($1, $2, 1)
         ON CONFLICT (tenant_id, aggregate_id)
         DO UPDATE SET last_sequence = aggregate_streams.last_sequence + 1
         RETURNING last_sequence`,
        [tenantId, aggregateId],
      );
      const row = result.rows[0];
      if (row === undefined)
        throw new Error(`could not claim a stream position for ${aggregateId}`);
      return Number(row.last_sequence);
    },
  };
}

interface CashRow {
  id: string;
  tenant_id: string;
  kind: MovementKind;
  account: CashAccount;
  driver_id: string | null;
  merchant_id: string | null;
  delta_minor: string;
  amount_minor: string;
  currency: string;
  reference: string;
  approved_by: string | null;
  occurred_at: Date;
}

function toCashEntry(row: CashRow): CashEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    account: row.account,
    ...(row.driver_id === null ? {} : { driverId: row.driver_id }),
    ...(row.merchant_id === null ? {} : { merchantId: row.merchant_id }),
    deltaMinor: Number(row.delta_minor),
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    reference: row.reference,
    ...(row.approved_by === null ? {} : { approvedBy: row.approved_by }),
    at: row.occurred_at,
  };
}

async function insertEntries(
  client: PoolClient,
  movementKey: string,
  entries: readonly CashEntry[],
): Promise<void> {
  for (const entry of entries) {
    await client.query(
      `INSERT INTO cash_entries (id, movement_key, tenant_id, kind, account, driver_id,
         merchant_id, delta_minor, amount_minor, currency, reference, approved_by, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        entry.id,
        movementKey,
        entry.tenantId,
        entry.kind,
        entry.account,
        entry.driverId ?? null,
        entry.merchantId ?? null,
        entry.deltaMinor,
        entry.amountMinor,
        entry.currency,
        entry.reference,
        entry.approvedBy ?? null,
        entry.at,
      ],
    );
  }
}

function cashQuery(tenantId: string, holder: CashHolder): [string, string] {
  return "driverId" in holder
    ? [
        `SELECT * FROM cash_entries WHERE tenant_id = $1 AND account = 'driver_float'
           AND driver_id = $2 ORDER BY occurred_at, id`,
        holder.driverId,
      ]
    : [
        `SELECT * FROM cash_entries WHERE tenant_id = $1 AND account = 'merchant_payable'
           AND merchant_id = $2 ORDER BY occurred_at, id`,
        holder.merchantId,
      ];
}

function cash(pool: Pool): Pick<MoneyRepository, "saveCashMovement" | "cashEntriesFor"> {
  return {
    async saveCashMovement(movementKey, entries) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `INSERT INTO cash_movements (movement_key, tenant_id) VALUES ($1, $2)
           ON CONFLICT (movement_key) DO NOTHING`,
          [movementKey, entries[0]?.tenantId ?? movementKey.split(":")[0]],
        );
        if (claimed.rowCount === 0) {
          await client.query("ROLLBACK");
          return false;
        }
        await insertEntries(client, movementKey, entries);
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async cashEntriesFor(tenantId, holder) {
      const [text, value] = cashQuery(tenantId, holder);
      const result = await pool.query<CashRow>(text, [tenantId, value]);
      return result.rows.map(toCashEntry);
    },
  };
}

export function postgresMoney(pool: Pool): MoneyRepository {
  return {
    ...carriers(pool),
    ...cards(pool),
    ...invoices(pool),
    ...settlements(pool),
    ...cash(pool),
    ...streams(pool),
  };
}
