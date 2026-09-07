import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresLinehaul } from "./repository.js";
import { apply, openBag, type Bag } from "../domain/bag.js";
import { apply as applyToTrip, planTrip, type Trip } from "../domain/trip.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_linehaul",
});
const repository = postgresLinehaul(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";

const bag = (): Bag =>
  apply(
    openBag({
      id: "01J8Z0T0000000000000000010",
      tenantId,
      originHubId: "hub-1",
      destinationHubId: "hub-2",
    }),
    { type: "parcel_added", consignmentId: "c-1" },
  );

const trip = (): Trip =>
  planTrip({
    id: "01J8Z0T0000000000000000020",
    tenantId,
    originHubId: "hub-1",
    destinationHubId: "hub-2",
    departsOn: "2026-09-08",
    capacityBags: 4,
  });

beforeEach(async () => {
  await pool.query(
    `DROP TABLE IF EXISTS trip_bags, trips, bag_parcels, bags, aggregate_streams,
       schema_migrations CASCADE`,
  );
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("bags in the database", () => {
  it("reads back a bag with its parcels in order", async () => {
    const filled = apply(bag(), { type: "parcel_added", consignmentId: "c-2" });
    await repository.saveBag(filled, 0);

    const found = await repository.bagById(tenantId, filled.id);
    expect(found?.bag.consignmentIds).toEqual(["c-1", "c-2"]);
  });

  it("forgets a parcel taken back out", async () => {
    await repository.saveBag(bag(), 0);
    const emptied = apply((await repository.bagById(tenantId, bag().id))?.bag ?? bag(), {
      type: "parcel_removed",
      consignmentId: "c-1",
    });
    await repository.saveBag(emptied, 1);

    const found = await repository.bagById(tenantId, bag().id);
    expect(found?.bag.consignmentIds).toEqual([]);
  });

  it("refuses a write that raced another one", async () => {
    await repository.saveBag(bag(), 0);

    await expect(repository.saveBag(bag(), 0)).rejects.toThrow(
      "changed while it was being updated",
    );
  });

  it("keeps only one open bag per lane, whatever the application asks", async () => {
    await repository.saveBag(bag(), 0);
    const second = { ...bag(), id: "01J8Z0T0000000000000000011" };

    await expect(repository.saveBag(second, 0)).rejects.toThrow(/bags_one_open_per_lane/);
  });

  it("allows a second bag on the lane once the first is sealed", async () => {
    const sealed = apply(bag(), { type: "sealed", sealNumber: "SEAL-1" });
    await repository.saveBag(sealed, 0);

    await expect(
      repository.saveBag({ ...bag(), id: "01J8Z0T0000000000000000011" }, 0),
    ).resolves.toBeUndefined();
  });

  it("finds the open bag for a lane and nothing else", async () => {
    await repository.saveBag(bag(), 0);

    expect((await repository.openBagFor(tenantId, "hub-1", "hub-2"))?.id).toBe(bag().id);
    expect(await repository.openBagFor(tenantId, "hub-1", "hub-9")).toBeUndefined();
    expect(await repository.openBagFor("other", "hub-1", "hub-2")).toBeUndefined();
  });

  it("lists the bags riding on a trip", async () => {
    const loaded = apply(apply(bag(), { type: "sealed", sealNumber: "SEAL-1" }), {
      type: "loaded",
      tripId: "trip-1",
    });
    await repository.saveBag(loaded, 0);

    const onTrip = await repository.bagsOnTrip(tenantId, "trip-1");
    expect(onTrip.map((b) => b.id)).toEqual([loaded.id]);
  });
});

describe("trips in the database", () => {
  it("reads back a trip with its bags in loading order", async () => {
    const crewed = applyToTrip(trip(), {
      type: "crewed",
      vehicleId: "veh-1",
      driverId: "drv-1",
    });
    const loaded = ["bag-2", "bag-1"].reduce(
      (t, bagId) => applyToTrip(t, { type: "bag_loaded", bagId }),
      crewed,
    );
    await repository.saveTrip(loaded, 0);

    const found = await repository.tripById(tenantId, trip().id);
    expect(found?.trip.bagIds).toEqual(["bag-2", "bag-1"]);
  });

  it("keeps the departure date as the calendar day it is", async () => {
    await repository.saveTrip(trip(), 0);

    expect((await repository.tripById(tenantId, trip().id))?.trip.departsOn).toBe("2026-09-08");
  });

  it("refuses a trip that has left with no crew", async () => {
    const bad = { ...trip(), status: "departed" as const };

    await expect(repository.saveTrip(bad, 0)).rejects.toThrow(/trips_are_crewed_before_they_leave/);
  });

  it("keeps one tenant's trips away from another", async () => {
    await repository.saveTrip(trip(), 0);

    expect(await repository.tripById("other", trip().id)).toBeUndefined();
  });

  it("drops a bag that came back off the trip", async () => {
    const crewed = applyToTrip(trip(), { type: "crewed", vehicleId: "v", driverId: "d" });
    const loaded = applyToTrip(crewed, { type: "bag_loaded", bagId: "bag-1" });
    await repository.saveTrip(loaded, 0);
    await repository.saveTrip(applyToTrip(loaded, { type: "bag_unloaded", bagId: "bag-1" }), 1);

    expect((await repository.tripById(tenantId, trip().id))?.trip.bagIds).toEqual([]);
  });
});

describe("what a hub has waiting, and what is on the road", () => {
  it("lists a hub's open and sealed bags and nothing that has left", async () => {
    await repository.saveBag(bag(), 0);
    const sealed = apply(
      { ...bag(), id: "01J8Z0T0000000000000000011" },
      { type: "sealed", sealNumber: "S" },
    );
    await repository.saveBag(sealed, 0);
    const gone = apply(sealed, { type: "loaded", tripId: "trip-1" });
    await repository.saveBag({ ...gone, id: "01J8Z0T0000000000000000012" }, 0);

    const waiting = await repository.bagsAtHub(tenantId, "hub-1");

    expect(waiting.map((b) => b.status).sort()).toEqual(["open", "sealed"]);
  });

  it("lists the trips still open, with the bags on them", async () => {
    const crewed = applyToTrip(trip(), { type: "crewed", vehicleId: "v", driverId: "d" });
    await repository.saveTrip(applyToTrip(crewed, { type: "bag_loaded", bagId: "bag-1" }), 0);
    await repository.saveTrip(
      applyToTrip(
        { ...trip(), id: "01J8Z0T0000000000000000021" },
        { type: "cancelled", reason: "no" },
      ),
      0,
    );

    const open = await repository.openTrips(tenantId);

    expect(open).toHaveLength(1);
    expect(open[0]?.bagIds).toEqual(["bag-1"]);
  });
});

describe("the far end of a bag's journey, in the database", () => {
  it("keeps where a bag was received", async () => {
    const travelled = apply(
      apply(apply(bag(), { type: "sealed", sealNumber: "S" }), { type: "loaded", tripId: "t1" }),
      { type: "received", hubId: "hub-9", sealIntact: false },
    );
    await repository.saveBag(travelled, 0);

    const found = await repository.bagById(tenantId, travelled.id);

    expect(found?.bag).toMatchObject({
      receivedAtHubId: "hub-9",
      misrouted: true,
      sealBroken: true,
    });
  });

  it("finds nothing for a bag nobody opened", async () => {
    expect(await repository.bagById(tenantId, "nowhere")).toBeUndefined();
  });

  it("keeps where a trip arrived, where it was diverted, and why it was cancelled", async () => {
    const crewed = applyToTrip(trip(), { type: "crewed", vehicleId: "v", driverId: "d" });
    const loaded = applyToTrip(crewed, { type: "bag_loaded", bagId: "b1" });
    const diverted = applyToTrip(applyToTrip(loaded, { type: "departed" }), {
      type: "arrived",
      hubId: "hub-9",
    });
    await repository.saveTrip(diverted, 0);
    const cancelled = applyToTrip(
      { ...trip(), id: "01J8Z0T0000000000000000022" },
      { type: "cancelled", reason: "broke down" },
    );
    await repository.saveTrip(cancelled, 0);

    const first = await repository.tripById(tenantId, diverted.id);
    const second = await repository.tripById(tenantId, cancelled.id);

    expect(first?.trip).toMatchObject({ arrivedAtHubId: "hub-9", divertedTo: "hub-9" });
    expect(second?.trip).toMatchObject({ cancelReason: "broke down" });
  });

  it("refuses a trip write that raced another one", async () => {
    await repository.saveTrip(trip(), 0);

    await expect(repository.saveTrip(trip(), 0)).rejects.toThrow(
      "changed while it was being updated",
    );
  });
});
