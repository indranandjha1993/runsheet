import { types, type Pool } from "pg";
import type { ExecutionRepository } from "../application/ports.js";
import type { Proof, ProofKind } from "../domain/proof.js";
import type { Run, RunStatus } from "../domain/run.js";
import type { Scan } from "../domain/hub-floor.js";
import type { ActionKind, ActionResult, Stop, StopAction } from "../domain/stop.js";

// A calendar date has no time zone. Left to its default the driver turns it into a Date at local
// midnight, which shifts the day backwards anywhere east of UTC. Read it as the string it is.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

interface RunRow {
  id: string;
  tenant_id: string;
  hub_id: string;
  run_date: string;
  status: RunStatus;
  worker_id: string | null;
  vehicle_id: string | null;
  declared_cash_minor: string | null;
  counted_cash_minor: string | null;
  forced_close: boolean;
  suspend_reason: string | null;
  version: string;
}

interface StopRow {
  id: string;
  sequence: number;
  state: "pending" | "en_route" | "arrived";
}

interface ActionRow {
  id: string;
  stop_id: string;
  kind: ActionKind;
  consignment_id: string;
  result: ActionResult | null;
  ndr_reason: string | null;
  proof_id: string | null;
  cash_collected_minor: string | null;
}

function toAction(row: ActionRow): StopAction {
  return {
    id: row.id,
    kind: row.kind,
    consignmentId: row.consignment_id,
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.ndr_reason === null ? {} : { ndrReason: row.ndr_reason }),
    ...(row.proof_id === null ? {} : { proofId: row.proof_id }),
    ...(row.cash_collected_minor === null
      ? {}
      : { cashCollectedMinor: Number(row.cash_collected_minor) }),
  };
}

function toRun(row: RunRow, stops: Stop[]): Run {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hubId: row.hub_id,
    date: row.run_date,
    status: row.status,
    stops,
    forcedClose: row.forced_close,
    ...(row.worker_id === null ? {} : { workerId: row.worker_id }),
    ...(row.vehicle_id === null ? {} : { vehicleId: row.vehicle_id }),
    ...(row.declared_cash_minor === null
      ? {}
      : { declaredCashMinor: Number(row.declared_cash_minor) }),
    ...(row.counted_cash_minor === null
      ? {}
      : { countedCashMinor: Number(row.counted_cash_minor) }),
    ...(row.suspend_reason === null ? {} : { suspendReason: row.suspend_reason }),
  };
}

async function loadStops(pool: Pool, runIds: string[]): Promise<Map<string, Stop[]>> {
  const byRun = new Map<string, Stop[]>();
  if (runIds.length === 0) return byRun;

  const stops = await pool.query<StopRow & { run_id: string }>(
    "SELECT id, run_id, sequence, state FROM stops WHERE run_id = ANY($1) ORDER BY sequence",
    [runIds],
  );
  const actions = await pool.query<ActionRow>(
    `SELECT * FROM stop_actions WHERE stop_id = ANY(
       SELECT id FROM stops WHERE run_id = ANY($1)) ORDER BY id`,
    [runIds],
  );
  const byStop = new Map<string, StopAction[]>();
  for (const row of actions.rows) {
    byStop.set(row.stop_id, [...(byStop.get(row.stop_id) ?? []), toAction(row)]);
  }
  for (const row of stops.rows) {
    const stop: Stop = {
      id: row.id,
      sequence: row.sequence,
      state: row.state,
      actions: byStop.get(row.id) ?? [],
    };
    byRun.set(row.run_id, [...(byRun.get(row.run_id) ?? []), stop]);
  }
  return byRun;
}

async function writeRun(pool: Pool, run: Run, expectedVersion: number): Promise<void> {
  const result = await pool.query(
    `INSERT INTO runs (id, tenant_id, hub_id, run_date, status, worker_id, vehicle_id,
       declared_cash_minor, counted_cash_minor, forced_close, suspend_reason, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, worker_id = EXCLUDED.worker_id,
       vehicle_id = EXCLUDED.vehicle_id, declared_cash_minor = EXCLUDED.declared_cash_minor,
       counted_cash_minor = EXCLUDED.counted_cash_minor, forced_close = EXCLUDED.forced_close,
       suspend_reason = EXCLUDED.suspend_reason, version = EXCLUDED.version, updated_at = now()
     WHERE runs.version = $13`,
    [
      run.id,
      run.tenantId,
      run.hubId,
      run.date,
      run.status,
      run.workerId ?? null,
      run.vehicleId ?? null,
      run.declaredCashMinor ?? null,
      run.countedCashMinor ?? null,
      run.forcedClose,
      run.suspendReason ?? null,
      expectedVersion + 1,
      expectedVersion,
    ],
  );
  if (result.rowCount === 0) {
    throw new Error(`run ${run.id} changed while it was being updated`);
  }
}

async function writeStops(pool: Pool, run: Run): Promise<void> {
  await pool.query("DELETE FROM stops WHERE run_id = $1 AND id <> ALL($2)", [
    run.id,
    run.stops.map((stop) => stop.id),
  ]);
  for (const stop of run.stops) {
    await pool.query(
      `INSERT INTO stops (id, run_id, sequence, state) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET sequence = EXCLUDED.sequence, state = EXCLUDED.state`,
      [stop.id, run.id, stop.sequence, stop.state],
    );
    for (const action of stop.actions) {
      await pool.query(
        `INSERT INTO stop_actions (id, stop_id, kind, consignment_id, result, ndr_reason,
           proof_id, cash_collected_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET result = EXCLUDED.result,
           ndr_reason = EXCLUDED.ndr_reason, proof_id = EXCLUDED.proof_id,
           cash_collected_minor = EXCLUDED.cash_collected_minor`,
        [
          action.id,
          stop.id,
          action.kind,
          action.consignmentId,
          action.result ?? null,
          action.ndrReason ?? null,
          action.proofId ?? null,
          action.cashCollectedMinor ?? null,
        ],
      );
    }
  }
}

function runQueries(pool: Pool): Pick<ExecutionRepository, "saveRun" | "runById" | "openRuns"> {
  return {
    async saveRun(run, expectedVersion) {
      await writeRun(pool, run, expectedVersion);
      await writeStops(pool, run);
    },

    async runById(tenantId, id) {
      const result = await pool.query<RunRow>(
        "SELECT * FROM runs WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;
      const stops = await loadStops(pool, [id]);
      return { run: toRun(row, stops.get(id) ?? []), version: Number(row.version) };
    },

    async openRuns(tenantId, hubId, date) {
      const result = await pool.query<RunRow>(
        `SELECT * FROM runs WHERE tenant_id = $1 AND hub_id = $2 AND run_date = $3
           AND status NOT IN ('closed','cancelled') ORDER BY id`,
        [tenantId, hubId, date],
      );
      const stops = await loadStops(
        pool,
        result.rows.map((row) => row.id),
      );
      return result.rows.map((row) => toRun(row, stops.get(row.id) ?? []));
    },
  };
}

interface ProofRow {
  id: string;
  tenant_id: string;
  consignment_id: string;
  kind: string;
  captured_at: Date;
  geofence_ok: boolean | null;
  media_ids: string[];
  satisfies_requirement: boolean;
  requirement: string;
}

function toProof(row: ProofRow): Proof {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    consignmentId: row.consignment_id,
    requirement: row.requirement,
    kinds: row.kind === "" ? [] : (row.kind.split(",") as ProofKind[]),
    capturedAt: row.captured_at,
    mediaIds: row.media_ids,
    satisfiesRequirement: row.satisfies_requirement,
    ...(row.geofence_ok === null ? {} : { geofenceOk: row.geofence_ok }),
  };
}

function proofQueries(pool: Pool): Pick<ExecutionRepository, "saveProof" | "proofById"> {
  return {
    async saveProof(proof) {
      await pool.query(
        `INSERT INTO proofs (id, tenant_id, consignment_id, kind, captured_at, geofence_ok,
           media_ids, satisfies_requirement, requirement)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          proof.id,
          proof.tenantId,
          proof.consignmentId,
          proof.kinds.join(","),
          proof.capturedAt,
          proof.geofenceOk ?? null,
          proof.mediaIds,
          proof.satisfiesRequirement,
          proof.requirement,
        ],
      );
    },

    async proofById(tenantId, id) {
      const result = await pool.query<ProofRow>(
        "SELECT * FROM proofs WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toProof(row);
    },
  };
}

interface ScanRow {
  tenant_id: string;
  hub_id: string;
  worker_id: string;
  consignment_id: string;
  scanned_at: Date;
  accepted: boolean;
  weight_grams: number | null;
  volumetric_grams: number | null;
  exception: string | null;
}

function toScan(row: ScanRow): Scan {
  return {
    tenantId: row.tenant_id,
    hubId: row.hub_id,
    workerId: row.worker_id,
    consignmentId: row.consignment_id,
    at: row.scanned_at,
    accepted: row.accepted,
    ...(row.weight_grams === null ? {} : { weightGrams: row.weight_grams }),
    ...(row.volumetric_grams === null ? {} : { volumetricGrams: row.volumetric_grams }),
    ...(row.exception === null ? {} : { exception: row.exception }),
  };
}

function scanQueries(pool: Pool): Pick<ExecutionRepository, "saveScan" | "scansFor"> {
  return {
    async saveScan(id, scan, direction, runId) {
      await pool.query(
        `INSERT INTO hub_scans (id, tenant_id, hub_id, worker_id, consignment_id, direction,
           run_id, scanned_at, accepted, weight_grams, volumetric_grams, exception)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          scan.tenantId,
          scan.hubId,
          scan.workerId,
          scan.consignmentId,
          direction,
          runId ?? null,
          scan.at,
          scan.accepted,
          scan.weightGrams ?? null,
          scan.volumetricGrams ?? null,
          scan.exception ?? null,
        ],
      );
    },

    async scansFor(tenantId, consignmentId) {
      const result = await pool.query<ScanRow>(
        `SELECT * FROM hub_scans WHERE tenant_id = $1 AND consignment_id = $2
         ORDER BY scanned_at, id`,
        [tenantId, consignmentId],
      );
      return result.rows.map(toScan);
    },
  };
}

function streamQueries(pool: Pool): Pick<ExecutionRepository, "nextSequence"> {
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

export function postgresExecution(pool: Pool): ExecutionRepository {
  return {
    ...runQueries(pool),
    ...proofQueries(pool),
    ...scanQueries(pool),
    ...streamQueries(pool),
  };
}
