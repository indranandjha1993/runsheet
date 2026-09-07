import type { Pool } from "pg";
import type { Promise as DeliveryPromise } from "../domain/promise.js";
import type { Notification, PromiseRepository } from "../application/ports.js";

interface PromiseRow {
  consignment_id: string;
  tenant_id: string;
  window_start: Date;
  window_end: Date;
  estimated_arrival: Date | null;
  last_notified_eta: Date | null;
  at_risk: boolean;
  settled: boolean;
  last_milestone: string | null;
}

interface NotificationRow {
  id: string;
  tenant_id: string;
  consignment_id: string;
  channel: string;
  template: string;
  locale: string;
  sent_at: Date | null;
  failed_reason: string | null;
}

function toPromise(row: PromiseRow): DeliveryPromise {
  return {
    consignmentId: row.consignment_id,
    tenantId: row.tenant_id,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    atRisk: row.at_risk,
    settled: row.settled,
    notifiable: false,
    ...(row.estimated_arrival === null ? {} : { estimatedArrival: row.estimated_arrival }),
    ...(row.last_notified_eta === null ? {} : { lastNotifiedEta: row.last_notified_eta }),
    ...(row.last_milestone === null ? {} : { lastMilestone: row.last_milestone }),
  };
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    consignmentId: row.consignment_id,
    channel: row.channel,
    template: row.template,
    locale: row.locale,
    ...(row.sent_at === null ? {} : { sentAt: row.sent_at }),
    ...(row.failed_reason === null ? {} : { failedReason: row.failed_reason }),
  };
}

const orNull = <T>(value: T | undefined): T | null => value ?? null;

function promises(pool: Pool): Pick<PromiseRepository, "save" | "byConsignment"> {
  return {
    async save(promise) {
      await pool.query(
        `INSERT INTO promises (consignment_id, tenant_id, window_start, window_end,
           estimated_arrival, last_notified_eta, at_risk, settled, last_milestone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (consignment_id) DO UPDATE SET
           estimated_arrival = EXCLUDED.estimated_arrival,
           last_notified_eta = COALESCE(EXCLUDED.last_notified_eta, promises.last_notified_eta),
           at_risk = EXCLUDED.at_risk, settled = EXCLUDED.settled,
           last_milestone = EXCLUDED.last_milestone, updated_at = now()`,
        [
          promise.consignmentId,
          promise.tenantId,
          promise.windowStart,
          promise.windowEnd,
          orNull(promise.estimatedArrival),
          orNull(promise.lastNotifiedEta),
          promise.atRisk,
          promise.settled,
          orNull(promise.lastMilestone),
        ],
      );
    },

    async byConsignment(tenantId, consignmentId) {
      const result = await pool.query<PromiseRow>(
        "SELECT * FROM promises WHERE tenant_id = $1 AND consignment_id = $2",
        [tenantId, consignmentId],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toPromise(row);
    },
  };
}

function notifications(
  pool: Pool,
): Pick<PromiseRepository, "recordNotification" | "notificationsFor"> {
  return {
    async recordNotification(notification) {
      await pool.query(
        `INSERT INTO notifications (id, tenant_id, consignment_id, channel, template, locale,
           sent_at, failed_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          notification.id,
          notification.tenantId,
          notification.consignmentId,
          notification.channel,
          notification.template,
          notification.locale,
          orNull(notification.sentAt),
          orNull(notification.failedReason),
        ],
      );
    },

    async notificationsFor(tenantId, consignmentId) {
      const result = await pool.query<NotificationRow>(
        `SELECT * FROM notifications WHERE tenant_id = $1 AND consignment_id = $2
         ORDER BY created_at`,
        [tenantId, consignmentId],
      );
      return result.rows.map(toNotification);
    },
  };
}

function streams(pool: Pool): Pick<PromiseRepository, "nextSequence"> {
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

export function postgresPromises(pool: Pool): PromiseRepository {
  return { ...promises(pool), ...notifications(pool), ...streams(pool) };
}
