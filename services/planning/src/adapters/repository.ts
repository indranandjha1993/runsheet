import { types, type Pool } from "pg";
import type { PlannedRun, PlanningRepository } from "../application/ports.js";

// A calendar date has no time zone; read it as the string it is. See the execution service for
// what happens when this is left to the driver's default.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

interface PlanRow {
  id: string;
  tenant_id: string;
  hub_id: string;
  plan_date: string;
  vehicle_id: string;
  estimated_minutes: number;
}

interface StopRow {
  plan_id: string;
  sequence: number;
  job_id: string;
}

async function writeRun(pool: Pool, run: PlannedRun): Promise<void> {
  await pool.query(
    `INSERT INTO plans (id, tenant_id, hub_id, plan_date, vehicle_id, estimated_minutes)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [run.id, run.tenantId, run.hubId, run.date, run.vehicleId, run.estimatedMinutes],
  );
  for (const stop of run.stops) {
    await pool.query("INSERT INTO plan_stops (plan_id, sequence, job_id) VALUES ($1,$2,$3)", [
      run.id,
      stop.sequence,
      stop.jobId,
    ]);
  }
}

async function stopsByPlan(pool: Pool, planIds: string[]): Promise<Map<string, StopRow[]>> {
  const stops = await pool.query<StopRow>(
    "SELECT * FROM plan_stops WHERE plan_id = ANY($1) ORDER BY sequence",
    [planIds],
  );
  const byPlan = new Map<string, StopRow[]>();
  for (const stop of stops.rows) {
    byPlan.set(stop.plan_id, [...(byPlan.get(stop.plan_id) ?? []), stop]);
  }
  return byPlan;
}

function toRun(row: PlanRow, stops: StopRow[]): PlannedRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hubId: row.hub_id,
    date: row.plan_date,
    vehicleId: row.vehicle_id,
    estimatedMinutes: row.estimated_minutes,
    stops: stops.map((stop) => ({ sequence: stop.sequence, jobId: stop.job_id })),
  };
}

function planQueries(pool: Pool): Omit<PlanningRepository, "nextSequence"> {
  return {
    // Replanning a day replaces the previous plan for that day entirely.
    async savePlan(runs, tenantId, hubId, date) {
      await pool.query(
        "DELETE FROM plans WHERE tenant_id = $1 AND hub_id = $2 AND plan_date = $3",
        [tenantId, hubId, date],
      );
      for (const run of runs) await writeRun(pool, run);
    },

    async planFor(tenantId, hubId, date) {
      const plans = await pool.query<PlanRow>(
        `SELECT * FROM plans WHERE tenant_id = $1 AND hub_id = $2 AND plan_date = $3
         ORDER BY id`,
        [tenantId, hubId, date],
      );
      if (plans.rows.length === 0) return [];

      const byPlan = await stopsByPlan(
        pool,
        plans.rows.map((row) => row.id),
      );
      return plans.rows.map((row) => toRun(row, byPlan.get(row.id) ?? []));
    },
  };
}

function streamQueries(pool: Pool): Pick<PlanningRepository, "nextSequence"> {
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

export function postgresPlanning(pool: Pool): PlanningRepository {
  return { ...planQueries(pool), ...streamQueries(pool) };
}
