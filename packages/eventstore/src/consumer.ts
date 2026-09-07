import type { Pool } from "pg";
import type { StoredEvent } from "./store.js";

export type HandleResult = "handled" | "skipped" | "parked";

export interface DeadLetter {
  readonly eventId: string;
  readonly reason: string;
}

export type Handler = (event: StoredEvent) => Promise<void>;

export interface IdempotentConsumer {
  handle(event: StoredEvent): Promise<HandleResult>;
  watermark(tenantId: string, aggregateId: string): Promise<number>;
  deadLetter(event: StoredEvent, reason: string): Promise<void>;
  deadLetters(): Promise<DeadLetter[]>;
}

async function readWatermark(
  pool: Pool,
  consumer: string,
  tenantId: string,
  aggregateId: string,
): Promise<number> {
  const result = await pool.query<{ last_sequence: string }>(
    `SELECT last_sequence FROM consumer_watermarks
     WHERE consumer = $1 AND tenant_id = $2 AND aggregate_id = $3`,
    [consumer, tenantId, aggregateId],
  );
  const row = result.rows[0];
  return row === undefined ? 0 : Number(row.last_sequence);
}

async function advance(pool: Pool, consumer: string, event: StoredEvent): Promise<void> {
  await pool.query(
    `INSERT INTO consumer_watermarks (consumer, tenant_id, aggregate_id, last_sequence)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (consumer, tenant_id, aggregate_id)
     DO UPDATE SET last_sequence = GREATEST(consumer_watermarks.last_sequence, EXCLUDED.last_sequence)`,
    [consumer, event.tenantId, event.aggregateId, event.sequence],
  );
}

export function idempotentConsumer(pool: Pool, name: string, handler: Handler): IdempotentConsumer {
  return {
    async handle(event) {
      const seen = await readWatermark(pool, name, event.tenantId, event.aggregateId);
      if (event.sequence <= seen) return "skipped";
      if (event.sequence > seen + 1) return "parked";

      await handler(event);
      await advance(pool, name, event);
      return "handled";
    },

    async watermark(tenantId, aggregateId) {
      return readWatermark(pool, name, tenantId, aggregateId);
    },

    async deadLetter(event, reason) {
      await pool.query(
        `INSERT INTO dead_letters (event_id, consumer, reason, payload)
         VALUES ($1, $2, $3, $4) ON CONFLICT (event_id, consumer) DO NOTHING`,
        [event.eventId, name, reason, event.payload],
      );
      await advance(pool, name, event);
    },

    async deadLetters() {
      const result = await pool.query<{ event_id: string; reason: string }>(
        `SELECT event_id, reason FROM dead_letters WHERE consumer = $1 ORDER BY failed_at`,
        [name],
      );
      return result.rows.map((row) => ({ eventId: row.event_id, reason: row.reason }));
    },
  };
}
