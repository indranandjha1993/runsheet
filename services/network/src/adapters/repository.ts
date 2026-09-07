import type { Pool } from "pg";
import { polygon, type Polygon } from "../domain/geo.js";
import type { Hub } from "../domain/hub.js";
import type { Lane } from "../domain/lane.js";
import type { Zone } from "../domain/zone.js";
import type { NetworkRepository } from "../application/ports.js";

interface HubRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  country_code: string;
  time_zone: string;
  latitude: number;
  longitude: number;
  opens_minutes_of_day: number;
  closes_minutes_of_day: number;
  active: boolean;
}

interface ZoneRow {
  id: string;
  hub_id: string;
  priority: number;
  boundary: (readonly [number, number])[];
  active: boolean;
}

interface LaneRow {
  id: string;
  origin_hub_id: string;
  destination_hub_id: string;
  service: string;
  transit_hours: string;
  cutoff_minutes_of_day: number;
  operating_days: number[];
}

function toHub(row: HubRow): Hub {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    countryCode: row.country_code,
    timeZone: row.time_zone,
    location: { latitude: row.latitude, longitude: row.longitude },
    opensMinutesOfDay: row.opens_minutes_of_day,
    closesMinutesOfDay: row.closes_minutes_of_day,
    active: row.active,
  };
}

// Boundaries are stored as the ring only. Edges are derived on read, so the stored shape stays
// the minimal truth and the invariant lives in one place.
function toZone(row: ZoneRow): Zone {
  return {
    id: row.id,
    hubId: row.hub_id,
    priority: row.priority,
    boundary: polygon(row.boundary),
    active: row.active,
  };
}

function toLane(row: LaneRow): Lane {
  return {
    id: row.id,
    originHubId: row.origin_hub_id,
    destinationHubId: row.destination_hub_id,
    service: row.service,
    transitHours: Number(row.transit_hours),
    cutoffMinutesOfDay: row.cutoff_minutes_of_day,
    operatingDays: row.operating_days,
  };
}

function ringOf(boundary: Polygon): (readonly [number, number])[] {
  return boundary.ring.map((p) => [p.latitude, p.longitude] as const);
}

function hubQueries(pool: Pool): Pick<NetworkRepository, "saveHub" | "hubByCode" | "hubById"> {
  const findBy = async (column: string, tenantId: string, value: string): Promise<Hub | undefined> => {
    const result = await pool.query<HubRow>(
      `SELECT * FROM hubs WHERE tenant_id = $1 AND ${column} = $2`,
      [tenantId, value],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toHub(row);
  };

  return {
    async saveHub(value) {
      await pool.query(
        `INSERT INTO hubs (id, tenant_id, code, name, country_code, time_zone, latitude,
           longitude, opens_minutes_of_day, closes_minutes_of_day, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          value.id,
          value.tenantId,
          value.code,
          value.name,
          value.countryCode,
          value.timeZone,
          value.location.latitude,
          value.location.longitude,
          value.opensMinutesOfDay,
          value.closesMinutesOfDay,
          value.active,
        ],
      );
    },
    hubByCode: (tenantId, code) => findBy("code", tenantId, code),
    hubById: (tenantId, id) => findBy("id", tenantId, id),
  };
}

function zoneQueries(pool: Pool): Pick<NetworkRepository, "saveZone" | "zonesFor"> {
  return {
    async saveZone(tenantId, zone) {
      await pool.query(
        `INSERT INTO zones (id, tenant_id, hub_id, priority, boundary, active)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          zone.id,
          tenantId,
          zone.hubId,
          zone.priority,
          JSON.stringify(ringOf(zone.boundary)),
          zone.active,
        ],
      );
    },
    async zonesFor(tenantId) {
      const result = await pool.query<ZoneRow>(
        "SELECT id, hub_id, priority, boundary, active FROM zones WHERE tenant_id = $1 AND active",
        [tenantId],
      );
      return result.rows.map(toZone);
    },
  };
}

function laneQueries(pool: Pool): Pick<NetworkRepository, "saveLane" | "lanesFrom"> {
  return {
    async saveLane(tenantId, value) {
      await pool.query(
        `INSERT INTO lanes (id, tenant_id, origin_hub_id, destination_hub_id, service,
           transit_hours, cutoff_minutes_of_day, operating_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          value.id,
          tenantId,
          value.originHubId,
          value.destinationHubId,
          value.service,
          value.transitHours,
          value.cutoffMinutesOfDay,
          value.operatingDays,
        ],
      );
    },
    async lanesFrom(tenantId, originHubId) {
      const result = await pool.query<LaneRow>(
        "SELECT * FROM lanes WHERE tenant_id = $1 AND origin_hub_id = $2",
        [tenantId, originHubId],
      );
      return result.rows.map(toLane);
    },
  };
}

function streamQueries(pool: Pool): Pick<NetworkRepository, "nextSequence"> {
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
      if (row === undefined) {
        throw new Error(`could not claim a stream position for ${aggregateId}`);
      }
      return Number(row.last_sequence);
    },
  };
}

export function postgresNetwork(pool: Pool): NetworkRepository {
  return {
    ...hubQueries(pool),
    ...zoneQueries(pool),
    ...laneQueries(pool),
    ...streamQueries(pool),
  };
}
