import type { Pool } from "pg";
import type { Consignment, Guards, Package, Status } from "../domain/consignment.js";
import type { Order, OrdersRepository } from "../application/ports.js";

interface ConsignmentRow {
  id: string;
  tenant_id: string;
  order_id: string;
  service: string;
  payment_mode: "prepaid" | "cod";
  status: Status;
  attempt_count: number;
  pickup_attempts: number;
  damaged: boolean;
  cancel_requested: boolean;
  current_hub_id: string | null;
  current_run_id: string | null;
  guards: Guards;
  version: string;
}

interface PackageRow {
  id: string;
  weight_grams: number;
}

function toConsignment(row: ConsignmentRow, packages: Package[]): Consignment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderId: row.order_id,
    service: row.service,
    paymentMode: row.payment_mode,
    guards: row.guards,
    packages,
    status: row.status,
    attemptCount: row.attempt_count,
    pickupAttempts: row.pickup_attempts,
    damaged: row.damaged,
    cancelRequested: row.cancel_requested,
    ...(row.current_hub_id === null ? {} : { currentHubId: row.current_hub_id }),
    ...(row.current_run_id === null ? {} : { currentRunId: row.current_run_id }),
  };
}

function orderQueries(pool: Pool): Pick<OrdersRepository, "saveOrder" | "orderByReference"> {
  return {
    async saveOrder(order) {
      await pool.query(
        "INSERT INTO orders (id, tenant_id, reference, payment_mode) VALUES ($1,$2,$3,$4)",
        [order.id, order.tenantId, order.reference, order.paymentMode],
      );
    },
    async orderByReference(tenantId, reference) {
      const result = await pool.query<Order & { tenant_id: string; payment_mode: "prepaid" | "cod" }>(
        "SELECT id, tenant_id, reference, payment_mode FROM orders WHERE tenant_id = $1 AND reference = $2",
        [tenantId, reference],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : { id: row.id, tenantId: row.tenant_id, reference: row.reference, paymentMode: row.payment_mode };
    },
  };
}

async function writeConsignment(pool: Pool, c: Consignment, expectedVersion: number): Promise<void> {
  const result = await pool.query(
    `INSERT INTO consignments (id, tenant_id, order_id, service, payment_mode, status,
       attempt_count, pickup_attempts, damaged, cancel_requested, current_hub_id, current_run_id,
       guards, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, attempt_count = EXCLUDED.attempt_count,
       pickup_attempts = EXCLUDED.pickup_attempts, damaged = EXCLUDED.damaged,
       cancel_requested = EXCLUDED.cancel_requested, current_hub_id = EXCLUDED.current_hub_id,
       current_run_id = EXCLUDED.current_run_id, version = EXCLUDED.version, updated_at = now()
     WHERE consignments.version = $15`,
    [
      c.id, c.tenantId, c.orderId, c.service, c.paymentMode, c.status, c.attemptCount,
      c.pickupAttempts, c.damaged, c.cancelRequested, c.currentHubId ?? null,
      c.currentRunId ?? null, JSON.stringify(c.guards), expectedVersion + 1, expectedVersion,
    ],
  );
  if (result.rowCount === 0) {
    throw new Error(`consignment ${c.id} changed while it was being updated`);
  }
}

async function loadPackages(pool: Pool, consignmentId: string): Promise<Package[]> {
  const parcels = await pool.query<PackageRow>(
    "SELECT id, weight_grams FROM packages WHERE consignment_id = $1 ORDER BY id",
    [consignmentId],
  );
  return parcels.rows.map((p) => ({ id: p.id, weightGrams: p.weight_grams }));
}

function consignmentQueries(
  pool: Pool,
): Pick<OrdersRepository, "saveConsignment" | "consignmentById" | "openConsignments"> {
  return {
    async saveConsignment(consignment, expectedVersion) {
      await writeConsignment(pool, consignment, expectedVersion);
      for (const parcel of consignment.packages) {
        await pool.query(
          `INSERT INTO packages (id, consignment_id, weight_grams) VALUES ($1,$2,$3)
           ON CONFLICT (id) DO NOTHING`,
          [parcel.id, consignment.id, parcel.weightGrams],
        );
      }
    },

    async consignmentById(tenantId, id) {
      const result = await pool.query<ConsignmentRow>(
        "SELECT * FROM consignments WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;

      return {
        consignment: toConsignment(row, await loadPackages(pool, id)),
        version: Number(row.version),
      };
    },

    async openConsignments(tenantId, limit) {
      const result = await pool.query<ConsignmentRow>(
        `SELECT * FROM consignments WHERE tenant_id = $1
           AND status NOT IN ('delivered','rto_delivered','cancelled')
         ORDER BY updated_at DESC LIMIT $2`,
        [tenantId, limit],
      );
      return result.rows.map((row) => toConsignment(row, []));
    },

  };
}

function streamQueries(pool: Pool): Pick<OrdersRepository, "nextSequence"> {
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

export function postgresOrders(pool: Pool): OrdersRepository {
  return { ...orderQueries(pool), ...consignmentQueries(pool), ...streamQueries(pool) };
}
