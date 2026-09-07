import { describe, expect, it } from "vitest";
import { apply, planTrip, type Trip } from "./trip.js";

const planned = (): Trip =>
  planTrip({
    id: "trip-1",
    tenantId: "t",
    originHubId: "hub-1",
    destinationHubId: "hub-2",
    departsOn: "2026-09-08",
    capacityBags: 3,
  });

const crewed = (): Trip =>
  apply(planned(), { type: "crewed", vehicleId: "veh-1", driverId: "drv-1" });

const loaded = (bags = ["bag-1"]): Trip =>
  bags.reduce<Trip>((trip, bagId) => apply(trip, { type: "bag_loaded", bagId }), crewed());

const departed = (): Trip => apply(loaded(), { type: "departed" });

describe("planning a trip", () => {
  it("starts planned with nothing on it", () => {
    expect(planned().status).toBe("planned");
    expect(planned().bagIds).toEqual([]);
  });

  it("refuses a trip that starts and ends at the same hub", () => {
    expect(() =>
      planTrip({
        id: "t",
        tenantId: "t",
        originHubId: "hub-1",
        destinationHubId: "hub-1",
        departsOn: "2026-09-08",
        capacityBags: 3,
      }),
    ).toThrow("a trip cannot end where it started");
  });

  it("refuses a trip with no room on it", () => {
    expect(() =>
      planTrip({
        id: "t",
        tenantId: "t",
        originHubId: "hub-1",
        destinationHubId: "hub-2",
        departsOn: "2026-09-08",
        capacityBags: 0,
      }),
    ).toThrow("a trip must have room for at least one bag");
  });
});

describe("loading a trip", () => {
  it("takes bags up to its capacity", () => {
    expect(loaded(["bag-1", "bag-2", "bag-3"]).bagIds).toHaveLength(3);
  });

  it("refuses the bag that would overfill it, rather than leaving it to the driver", () => {
    const full = loaded(["bag-1", "bag-2", "bag-3"]);

    expect(() => apply(full, { type: "bag_loaded", bagId: "bag-4" })).toThrow(
      "that trip has no room for another bag",
    );
  });

  it("ignores a bag scanned onto the same trip twice", () => {
    const trip = apply(loaded(["bag-1"]), { type: "bag_loaded", bagId: "bag-1" });

    expect(trip.bagIds).toEqual(["bag-1"]);
  });

  it("lets a bag come back off before departure", () => {
    const trip = apply(loaded(["bag-1", "bag-2"]), { type: "bag_unloaded", bagId: "bag-1" });

    expect(trip.bagIds).toEqual(["bag-2"]);
  });

  it("refuses to load a trip with no vehicle and no driver", () => {
    expect(() => apply(planned(), { type: "bag_loaded", bagId: "bag-1" })).toThrow(
      "a trip needs a vehicle and a driver before it is loaded",
    );
  });
});

describe("running a trip", () => {
  it("departs once it is crewed and loaded", () => {
    expect(departed().status).toBe("departed");
  });

  it("refuses to depart empty, because an empty trip is a mistake, not a journey", () => {
    expect(() => apply(crewed(), { type: "departed" })).toThrow("an empty trip cannot depart");
  });

  it("refuses a bag loaded after departure", () => {
    expect(() => apply(departed(), { type: "bag_loaded", bagId: "bag-2" })).toThrow(
      "a trip that has left cannot be loaded",
    );
  });

  it("arrives, and remembers where", () => {
    const trip = apply(departed(), { type: "arrived", hubId: "hub-2" });

    expect(trip.status).toBe("arrived");
    expect(trip.arrivedAtHubId).toBe("hub-2");
  });

  it("arrives at the wrong hub without pretending otherwise", () => {
    const trip = apply(departed(), { type: "arrived", hubId: "hub-9" });

    expect(trip.status).toBe("arrived");
    expect(trip.divertedTo).toBe("hub-9");
  });

  it("closes once every bag has been handed over", () => {
    const arrived = apply(departed(), { type: "arrived", hubId: "hub-2" });
    const trip = apply(arrived, { type: "closed", receivedBagIds: ["bag-1"] });

    expect(trip.status).toBe("closed");
    expect(trip.missingBagIds).toEqual([]);
  });

  it("names the bags that did not come off, which is the only way a bag is found", () => {
    const arrived = apply(apply(loaded(["bag-1", "bag-2"]), { type: "departed" }), {
      type: "arrived",
      hubId: "hub-2",
    });
    const trip = apply(arrived, { type: "closed", receivedBagIds: ["bag-1"] });

    expect(trip.missingBagIds).toEqual(["bag-2"]);
  });

  it("refuses to close a trip that has not arrived", () => {
    expect(() => apply(departed(), { type: "closed", receivedBagIds: [] })).toThrow(
      "only a trip that has arrived can be closed",
    );
  });

  it("can be cancelled before it leaves", () => {
    expect(apply(crewed(), { type: "cancelled", reason: "vehicle broke down" }).status).toBe(
      "cancelled",
    );
  });

  it("cannot be cancelled once it is on the road", () => {
    expect(() => apply(departed(), { type: "cancelled", reason: "changed our mind" })).toThrow(
      "a trip that has left cannot be cancelled",
    );
  });
});
