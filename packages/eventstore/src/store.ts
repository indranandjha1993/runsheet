import type { Envelope, EventSource } from "@runsheet/kernel";
import type { Pool, PoolClient } from "pg";

const UNIQUE_VIOLATION = "23505";

export interface StoredEvent extends Envelope {
  readonly payload: Record<string, unknown>;
}

export interface PendingMessage {
  readonly eventId: string;
  readonly topic: string;
  readonly partitionKey: string;
}

export interface EventStore {
  append(event: Envelope, payload: Record<string, unknown>, topic: string): Promise<void>;
  readStream(tenantId: string, aggregateId: string): Promise<StoredEvent[]>;
  pendingOutbox(limit: number): Promise<PendingMessage[]>;
  markPublished(eventIds: string[]): Promise<void>;
}

interface EventRow {
  event_id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: string;
  type: string;
  version: number;
  occurred_at: Date;
  recorded_at: Date;
  source: string;
  correlation_id: string;
  causation_id: string | null;
  confidence: string | null;
  payload: Record<string, unknown>;
}

function toStoredEvent(row: EventRow): StoredEvent {
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    sequence: Number(row.sequence),
    type: row.type,
    version: row.version,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    source: row.source as EventSource,
    correlationId: row.correlation_id,
    ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
    ...(row.confidence === null ? {} : { confidence: Number(row.confidence) }),
    payload: row.payload,
  };
}

function isDuplicatePosition(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

async function insert(
  client: PoolClient,
  event: Envelope,
  payload: Record<string, unknown>,
  topic: string,
): Promise<void> {
  await client.query(
    `INSERT INTO events (event_id, tenant_id, aggregate_type, aggregate_id, sequence, type,
       version, occurred_at, recorded_at, source, correlation_id, causation_id, confidence, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      event.eventId,
      event.tenantId,
      event.aggregateType,
      event.aggregateId,
      event.sequence,
      event.type,
      event.version,
      event.occurredAt,
      event.recordedAt,
      event.source,
      event.correlationId,
      event.causationId ?? null,
      event.confidence ?? null,
      payload,
    ],
  );
  await client.query(`INSERT INTO outbox (event_id, topic, partition_key) VALUES ($1, $2, $3)`, [
    event.eventId,
    topic,
    `${event.tenantId}:${event.aggregateId}`,
  ]);
}

async function appendInTransaction(
  pool: Pool,
  event: Envelope,
  payload: Record<string, unknown>,
  topic: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insert(client, event, payload, topic);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (isDuplicatePosition(error)) {
      throw new Error(`stream position ${String(event.sequence)} already taken`, { cause: error });
    }
    throw error;
  } finally {
    client.release();
  }
}

export function eventStore(pool: Pool): EventStore {
  return {
    async append(event, payload, topic) {
      await appendInTransaction(pool, event, payload, topic);
    },

    async readStream(tenantId, aggregateId) {
      const result = await pool.query<EventRow>(
        `SELECT * FROM events WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY sequence`,
        [tenantId, aggregateId],
      );
      return result.rows.map(toStoredEvent);
    },

    async pendingOutbox(limit) {
      const result = await pool.query<{ event_id: string; topic: string; partition_key: string }>(
        `SELECT event_id, topic, partition_key FROM outbox
         WHERE published_at IS NULL ORDER BY event_id LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        eventId: row.event_id,
        topic: row.topic,
        partitionKey: row.partition_key,
      }));
    },

    async markPublished(eventIds) {
      if (eventIds.length === 0) return;
      await pool.query(`UPDATE outbox SET published_at = now() WHERE event_id = ANY($1)`, [
        eventIds,
      ]);
    },
  };
}
