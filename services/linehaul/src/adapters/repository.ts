import { types, type Pool } from "pg";
import type { LinehaulRepository } from "../application/ports.js";
import type { Bag, BagStatus } from "../domain/bag.js";
import type { Trip, TripStatus } from "../domain/trip.js";

// A departure date has no time zone. Read it as the string it is, or the driver's day shifts
// backwards everywhere east of UTC.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

interface BagRow {
  id: string;
  tenant_id: string;
  origin_hub_id: string;
  destination_hub_id: string;
  status: BagStatus;
  seal_number: string | null;
  trip_id: string | null;
  received_at_hub_id: string | null;
  seal_broken: boolean;
  misrouted: boolean;
  missing_ids: string[];
  unexpected_ids: string[];
  version: string;
}

function toBag(row: BagRow, consignmentIds: string[]): Bag {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    originHubId: row.origin_hub_id,
    destinationHubId: row.destination_hub_id,
    status: row.status,
    consignmentIds,
    sealBroken: row.seal_broken,
    misrouted: row.misrouted,
    missingIds: row.missing_ids,
    unexpectedIds: row.unexpected_ids,
    ...(row.seal_number === null ? {} : { sealNumber: row.seal_number }),
    ...(row.trip_id === null ? {} : { tripId: row.trip_id }),
    ...(row.received_at_hub_id === null ? {} : { receivedAtHubId: row.received_at_hub_id }),
  };
}

async function parcelsIn(pool: Pool, bagIds: string[]): Promise<Map<string, string[]>> {
  const byBag = new Map<string, string[]>();
  if (bagIds.length === 0) return byBag;

  const result = await pool.query<{ bag_id: string; consignment_id: string }>(
    "SELECT bag_id, consignment_id FROM bag_parcels WHERE bag_id = ANY($1) ORDER BY position",
    [bagIds],
  );
  for (const row of result.rows) {
    byBag.set(row.bag_id, [...(byBag.get(row.bag_id) ?? []), row.consignment_id]);
  }
  return byBag;
}

async function writeBag(pool: Pool, bag: Bag, expectedVersion: number): Promise<void> {
  const result = await pool.query(
    `INSERT INTO bags (id, tenant_id, origin_hub_id, destination_hub_id, status, seal_number,
       trip_id, received_at_hub_id, seal_broken, misrouted, missing_ids, unexpected_ids, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, seal_number = EXCLUDED.seal_number, trip_id = EXCLUDED.trip_id,
       received_at_hub_id = EXCLUDED.received_at_hub_id, seal_broken = EXCLUDED.seal_broken,
       misrouted = EXCLUDED.misrouted, missing_ids = EXCLUDED.missing_ids,
       unexpected_ids = EXCLUDED.unexpected_ids, version = EXCLUDED.version, updated_at = now()
     WHERE bags.version = $14`,
    [
      bag.id,
      bag.tenantId,
      bag.originHubId,
      bag.destinationHubId,
      bag.status,
      bag.sealNumber ?? null,
      bag.tripId ?? null,
      bag.receivedAtHubId ?? null,
      bag.sealBroken,
      bag.misrouted,
      bag.missingIds,
      bag.unexpectedIds,
      expectedVersion + 1,
      expectedVersion,
    ],
  );
  if (result.rowCount === 0) throw new Error(`bag ${bag.id} changed while it was being updated`);
}

async function writeParcels(pool: Pool, bag: Bag): Promise<void> {
  await pool.query("DELETE FROM bag_parcels WHERE bag_id = $1 AND consignment_id <> ALL($2)", [
    bag.id,
    bag.consignmentIds,
  ]);
  for (const [position, consignmentId] of bag.consignmentIds.entries()) {
    await pool.query(
      `INSERT INTO bag_parcels (bag_id, consignment_id, position) VALUES ($1,$2,$3)
       ON CONFLICT (bag_id, consignment_id) DO UPDATE SET position = EXCLUDED.position`,
      [bag.id, consignmentId, position],
    );
  }
}

async function bagsWhere(pool: Pool, where: string, values: unknown[]): Promise<Bag[]> {
  const result = await pool.query<BagRow>(
    `SELECT * FROM bags WHERE tenant_id = $1 AND ${where} ORDER BY id`,
    values,
  );
  const parcels = await parcelsIn(
    pool,
    result.rows.map((row) => row.id),
  );
  return result.rows.map((row) => toBag(row, parcels.get(row.id) ?? []));
}

function bagQueries(
  pool: Pool,
): Pick<LinehaulRepository, "saveBag" | "bagById" | "bagsOnTrip" | "openBagFor" | "bagsAtHub"> {
  return {
    async saveBag(bag, expectedVersion) {
      await writeBag(pool, bag, expectedVersion);
      await writeParcels(pool, bag);
    },

    async bagById(tenantId, id) {
      const result = await pool.query<BagRow>(
        "SELECT * FROM bags WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;
      const parcels = await parcelsIn(pool, [id]);
      return { bag: toBag(row, parcels.get(id) ?? []), version: Number(row.version) };
    },

    bagsOnTrip: (tenantId, tripId) => bagsWhere(pool, "trip_id = $2", [tenantId, tripId]),

    bagsAtHub: (tenantId, hubId) =>
      bagsWhere(pool, "origin_hub_id = $2 AND status IN ('open', 'sealed')", [tenantId, hubId]),

    openBagFor: async (tenantId, originHubId, destinationHubId) => {
      const found = await bagsWhere(
        pool,
        "origin_hub_id = $2 AND destination_hub_id = $3 AND status = 'open'",
        [tenantId, originHubId, destinationHubId],
      );
      return found[0];
    },
  };
}

interface TripRow {
  id: string;
  tenant_id: string;
  origin_hub_id: string;
  destination_hub_id: string;
  departs_on: string;
  capacity_bags: number;
  status: TripStatus;
  vehicle_id: string | null;
  driver_id: string | null;
  arrived_at_hub_id: string | null;
  diverted_to: string | null;
  missing_bag_ids: string[];
  cancel_reason: string | null;
  version: string;
}

function toTrip(row: TripRow, bagIds: string[]): Trip {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    originHubId: row.origin_hub_id,
    destinationHubId: row.destination_hub_id,
    departsOn: row.departs_on,
    capacityBags: row.capacity_bags,
    status: row.status,
    bagIds,
    missingBagIds: row.missing_bag_ids,
    ...(row.vehicle_id === null ? {} : { vehicleId: row.vehicle_id }),
    ...(row.driver_id === null ? {} : { driverId: row.driver_id }),
    ...(row.arrived_at_hub_id === null ? {} : { arrivedAtHubId: row.arrived_at_hub_id }),
    ...(row.diverted_to === null ? {} : { divertedTo: row.diverted_to }),
    ...(row.cancel_reason === null ? {} : { cancelReason: row.cancel_reason }),
  };
}

async function writeTrip(pool: Pool, trip: Trip, expectedVersion: number): Promise<void> {
  const result = await pool.query(
    `INSERT INTO trips (id, tenant_id, origin_hub_id, destination_hub_id, departs_on,
       capacity_bags, status, vehicle_id, driver_id, arrived_at_hub_id, diverted_to,
       missing_bag_ids, cancel_reason, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, vehicle_id = EXCLUDED.vehicle_id,
       driver_id = EXCLUDED.driver_id, arrived_at_hub_id = EXCLUDED.arrived_at_hub_id,
       diverted_to = EXCLUDED.diverted_to, missing_bag_ids = EXCLUDED.missing_bag_ids,
       cancel_reason = EXCLUDED.cancel_reason, version = EXCLUDED.version, updated_at = now()
     WHERE trips.version = $15`,
    [
      trip.id,
      trip.tenantId,
      trip.originHubId,
      trip.destinationHubId,
      trip.departsOn,
      trip.capacityBags,
      trip.status,
      trip.vehicleId ?? null,
      trip.driverId ?? null,
      trip.arrivedAtHubId ?? null,
      trip.divertedTo ?? null,
      trip.missingBagIds,
      trip.cancelReason ?? null,
      expectedVersion + 1,
      expectedVersion,
    ],
  );
  if (result.rowCount === 0) throw new Error(`trip ${trip.id} changed while it was being updated`);
}

async function openTripsIn(pool: Pool, tenantId: string): Promise<Trip[]> {
  const result = await pool.query<TripRow>(
    `SELECT * FROM trips WHERE tenant_id = $1 AND status NOT IN ('closed', 'cancelled')
       ORDER BY departs_on, id`,
    [tenantId],
  );
  const loads = await pool.query<{ trip_id: string; bag_id: string }>(
    "SELECT trip_id, bag_id FROM trip_bags WHERE trip_id = ANY($1) ORDER BY position",
    [result.rows.map((row) => row.id)],
  );
  const bagsOf = new Map<string, string[]>();
  for (const load of loads.rows) {
    bagsOf.set(load.trip_id, [...(bagsOf.get(load.trip_id) ?? []), load.bag_id]);
  }
  return result.rows.map((row) => toTrip(row, bagsOf.get(row.id) ?? []));
}

function tripQueries(pool: Pool): Pick<LinehaulRepository, "saveTrip" | "tripById" | "openTrips"> {
  return {
    openTrips: (tenantId) => openTripsIn(pool, tenantId),

    async saveTrip(trip, expectedVersion) {
      await writeTrip(pool, trip, expectedVersion);
      await pool.query("DELETE FROM trip_bags WHERE trip_id = $1 AND bag_id <> ALL($2)", [
        trip.id,
        trip.bagIds,
      ]);
      for (const [position, bagId] of trip.bagIds.entries()) {
        await pool.query(
          `INSERT INTO trip_bags (trip_id, bag_id, position) VALUES ($1,$2,$3)
           ON CONFLICT (trip_id, bag_id) DO UPDATE SET position = EXCLUDED.position`,
          [trip.id, bagId, position],
        );
      }
    },

    async tripById(tenantId, id) {
      const result = await pool.query<TripRow>(
        "SELECT * FROM trips WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;

      const bags = await pool.query<{ bag_id: string }>(
        "SELECT bag_id FROM trip_bags WHERE trip_id = $1 ORDER BY position",
        [id],
      );
      return {
        trip: toTrip(
          row,
          bags.rows.map((bag) => bag.bag_id),
        ),
        version: Number(row.version),
      };
    },
  };
}

function streamQueries(pool: Pool): Pick<LinehaulRepository, "nextSequence"> {
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

export function postgresLinehaul(pool: Pool): LinehaulRepository {
  return { ...bagQueries(pool), ...tripQueries(pool), ...streamQueries(pool) };
}
