import type { Pool } from "pg";
import type { Exception, ExceptionState, Severity } from "../domain/exception.js";
import type { ExceptionsRepository } from "../application/ports.js";

interface Row {
  id: string;
  tenant_id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  detail: Record<string, unknown>;
  severity: Severity;
  state: ExceptionState;
  started_at: Date;
  allowance_minutes: number;
  paused_at: Date | null;
  paused_minutes: number;
  sla_breached: boolean;
  reopen_count: number;
  assigned_to: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  resolved_automatically: boolean;
}

function toException(row: Row): Exception {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    detail: row.detail,
    severity: row.severity,
    state: row.state,
    clock: {
      startedAt: row.started_at,
      allowanceMinutes: row.allowance_minutes,
      pausedMinutes: row.paused_minutes,
      ...(row.paused_at === null ? {} : { pausedAt: row.paused_at }),
    },
    slaBreached: row.sla_breached,
    reopenCount: row.reopen_count,
    resolvedAutomatically: row.resolved_automatically,
    ...(row.assigned_to === null ? {} : { assignedTo: row.assigned_to }),
    ...(row.resolved_by === null ? {} : { resolvedBy: row.resolved_by }),
    ...(row.resolution_note === null ? {} : { resolutionNote: row.resolution_note }),
  };
}

const orNull = <T,>(value: T | undefined): T | null => value ?? null;

function valuesOf(exception: Exception): unknown[] {
  const { clock } = exception;
  return [
    exception.id,
    exception.tenantId,
    exception.type,
    exception.subjectType,
    exception.subjectId,
    JSON.stringify(exception.detail),
    exception.severity,
    exception.state,
    clock.startedAt,
    clock.allowanceMinutes,
    orNull(clock.pausedAt),
    clock.pausedMinutes,
    exception.slaBreached,
    exception.reopenCount,
    orNull(exception.assignedTo),
    orNull(exception.resolvedBy),
    orNull(exception.resolutionNote),
    exception.resolvedAutomatically,
  ];
}

function writes(pool: Pool): Pick<ExceptionsRepository, "save"> {
  return {
    async save(exception) {
      await pool.query(
        `INSERT INTO exceptions (id, tenant_id, type, subject_type, subject_id, detail, severity,
           state, started_at, allowance_minutes, paused_at, paused_minutes, sla_breached,
           reopen_count, assigned_to, resolved_by, resolution_note, resolved_automatically)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, paused_at = EXCLUDED.paused_at,
           paused_minutes = EXCLUDED.paused_minutes, sla_breached = EXCLUDED.sla_breached,
           reopen_count = EXCLUDED.reopen_count, assigned_to = EXCLUDED.assigned_to,
           resolved_by = EXCLUDED.resolved_by, resolution_note = EXCLUDED.resolution_note,
           resolved_automatically = EXCLUDED.resolved_automatically, updated_at = now()`,
        valuesOf(exception),
      );
    },
  };
}

function reads(pool: Pool): Pick<ExceptionsRepository, "byId" | "openFor" | "queue"> {
  return {
    async byId(tenantId, id) {
      const result = await pool.query<Row>(
        "SELECT * FROM exceptions WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toException(row);
    },

    async openFor(tenantId, type, subjectId) {
      const result = await pool.query<Row>(
        `SELECT * FROM exceptions
         WHERE tenant_id = $1 AND type = $2 AND subject_id = $3 AND state <> 'resolved'`,
        [tenantId, type, subjectId],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toException(row);
    },

    async queue(tenantId, severity) {
      const result = await pool.query<Row>(
        `SELECT * FROM exceptions
         WHERE tenant_id = $1 AND state <> 'resolved' AND ($2::text IS NULL OR severity = $2)
         ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, started_at`,
        [tenantId, severity ?? null],
      );
      return result.rows.map(toException);
    },
  };
}

function streams(pool: Pool): Pick<ExceptionsRepository, "nextSequence"> {
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
      if (row === undefined) throw new Error(`could not claim a stream position for ${aggregateId}`);
      return Number(row.last_sequence);
    },
  };
}

export function postgresExceptions(pool: Pool): ExceptionsRepository {
  return { ...writes(pool), ...reads(pool), ...streams(pool) };
}
