import { beforeEach, describe, expect, it } from "vitest";
import { bagParcel, recordBagEvent, sealBag } from "./bag-operations.js";
import { loadBag, planTripFor, recordTripEvent } from "./trip-operations.js";
import type { LinehaulDeps } from "./ports.js";
import { testDeps } from "./test-doubles.js";

let deps: LinehaulDeps & { publisher: { published: { event: { type: string } }[] } };

beforeEach(() => {
  deps = testDeps();
});

const at = { tenantId: "t", originHubId: "hub-1", destinationHubId: "hub-2" };

describe("bagging a parcel", () => {
  it("opens a bag for the lane when there is not one open", async () => {
    const bag = await bagParcel(deps, { ...at, consignmentId: "c-1" });

    expect(bag.status).toBe("open");
    expect(bag.consignmentIds).toEqual(["c-1"]);
  });

  it("puts the next parcel in the bag that is already open", async () => {
    const first = await bagParcel(deps, { ...at, consignmentId: "c-1" });
    const second = await bagParcel(deps, { ...at, consignmentId: "c-2" });

    expect(second.id).toBe(first.id);
    expect(second.consignmentIds).toEqual(["c-1", "c-2"]);
  });

  it("opens a separate bag for a different destination", async () => {
    const first = await bagParcel(deps, { ...at, consignmentId: "c-1" });
    const other = await bagParcel(deps, {
      ...at,
      destinationHubId: "hub-3",
      consignmentId: "c-2",
    });

    expect(other.id).not.toBe(first.id);
  });

  it("announces the parcel went into a bag", async () => {
    await bagParcel(deps, { ...at, consignmentId: "c-1" });

    expect(deps.publisher.published.map((p) => p.event.type)).toContain("bag.parcel_added");
  });
});

describe("sealing a bag", () => {
  it("seals it and announces the seal number", async () => {
    const open = await bagParcel(deps, { ...at, consignmentId: "c-1" });

    const bag = await sealBag(deps, { tenantId: "t", bagId: open.id, sealNumber: "SEAL-1" });

    expect(bag.status).toBe("sealed");
    expect(deps.publisher.published.map((p) => p.event.type)).toContain("bag.sealed");
  });

  it("leaves the next parcel to a fresh bag once the old one is sealed", async () => {
    const open = await bagParcel(deps, { ...at, consignmentId: "c-1" });
    await sealBag(deps, { tenantId: "t", bagId: open.id, sealNumber: "SEAL-1" });

    const next = await bagParcel(deps, { ...at, consignmentId: "c-2" });

    expect(next.id).not.toBe(open.id);
  });

  it("refuses to seal a bag nobody opened", async () => {
    await expect(
      sealBag(deps, { tenantId: "t", bagId: "missing", sealNumber: "SEAL-1" }),
    ).rejects.toThrow("no bag with that identifier");
  });
});

describe("loading a bag onto a trip", () => {
  async function ready(): Promise<{ bagId: string; tripId: string }> {
    const open = await bagParcel(deps, { ...at, consignmentId: "c-1" });
    await sealBag(deps, { tenantId: "t", bagId: open.id, sealNumber: "SEAL-1" });
    const trip = await planTripFor(deps, {
      tenantId: "t",
      originHubId: "hub-1",
      destinationHubId: "hub-2",
      departsOn: "2026-09-08",
      capacityBags: 2,
    });
    await recordTripEvent(deps, {
      tenantId: "t",
      tripId: trip.id,
      event: { type: "crewed", vehicleId: "veh-1", driverId: "drv-1" },
    });
    return { bagId: open.id, tripId: trip.id };
  }

  it("moves the bag and the trip together", async () => {
    const { bagId, tripId } = await ready();

    const result = await loadBag(deps, { tenantId: "t", tripId, bagId });

    expect(result.bag.status).toBe("in_transit");
    expect(result.trip.bagIds).toEqual([bagId]);
  });

  it("announces both sides, because a parcel is followed through the bag", async () => {
    const { bagId, tripId } = await ready();

    await loadBag(deps, { tenantId: "t", tripId, bagId });

    const types = deps.publisher.published.map((p) => p.event.type);
    expect(types).toContain("trip.bag_loaded");
    expect(types).toContain("bag.loaded");
  });

  it("leaves the trip untouched when the bag cannot be loaded", async () => {
    const { tripId } = await ready();
    const unsealed = await bagParcel(deps, {
      tenantId: "t",
      originHubId: "hub-1",
      destinationHubId: "hub-4",
      consignmentId: "c-9",
    });

    await expect(loadBag(deps, { tenantId: "t", tripId, bagId: unsealed.id })).rejects.toThrow(
      "only a sealed bag can be loaded",
    );

    const after = await deps.repository.tripById("t", tripId);
    expect(after?.trip.bagIds).toEqual([]);
  });

  it("refuses a bag from another tenant", async () => {
    const { tripId, bagId } = await ready();

    await expect(loadBag(deps, { tenantId: "other", tripId, bagId })).rejects.toThrow(
      "no trip with that identifier",
    );
  });
});

describe("emptying a bag at the far end", () => {
  it("reports what was missing", async () => {
    const open = await bagParcel(deps, { ...at, consignmentId: "c-1" });
    await bagParcel(deps, { ...at, consignmentId: "c-2" });
    await sealBag(deps, { tenantId: "t", bagId: open.id, sealNumber: "SEAL-1" });
    await recordBagEvent(deps, {
      tenantId: "t",
      bagId: open.id,
      event: { type: "loaded", tripId: "trip-1" },
    });
    await recordBagEvent(deps, {
      tenantId: "t",
      bagId: open.id,
      event: { type: "received", hubId: "hub-2", sealIntact: true },
    });

    const bag = await recordBagEvent(deps, {
      tenantId: "t",
      bagId: open.id,
      event: { type: "emptied", scannedIds: ["c-1"] },
    });

    expect(bag.missingIds).toEqual(["c-2"]);
    expect(deps.publisher.published.map((p) => p.event.type)).toContain("bag.discrepancy_found");
  });

  it("announces nothing about discrepancies when everything came out", async () => {
    const open = await bagParcel(deps, { ...at, consignmentId: "c-1" });
    await sealBag(deps, { tenantId: "t", bagId: open.id, sealNumber: "SEAL-1" });
    await recordBagEvent(deps, {
      tenantId: "t",
      bagId: open.id,
      event: { type: "loaded", tripId: "trip-1" },
    });
    await recordBagEvent(deps, {
      tenantId: "t",
      bagId: open.id,
      event: { type: "received", hubId: "hub-2", sealIntact: true },
    });
    await recordBagEvent(deps, {
      tenantId: "t",
      bagId: open.id,
      event: { type: "emptied", scannedIds: ["c-1"] },
    });

    expect(deps.publisher.published.map((p) => p.event.type)).not.toContain(
      "bag.discrepancy_found",
    );
  });

  it("raises a discrepancy for a broken seal even when every parcel is there", async () => {
    const open = await bagParcel(deps, { ...at, consignmentId: "c-1" });
    await sealBag(deps, { tenantId: "t", bagId: open.id, sealNumber: "SEAL-1" });
    await recordBagEvent(deps, {
      tenantId: "t",
      bagId: open.id,
      event: { type: "loaded", tripId: "trip-1" },
    });

    await recordBagEvent(deps, {
      tenantId: "t",
      bagId: open.id,
      event: { type: "received", hubId: "hub-2", sealIntact: false },
    });

    expect(deps.publisher.published.map((p) => p.event.type)).toContain("bag.seal_broken");
  });
});
