import { describe, expect, it } from "vitest";
import { manifestFor, reconcile } from "./manifest.js";

const bags = [
  { id: "bag-1", sealNumber: "SEAL-1", destinationHubId: "hub-2", consignmentIds: ["c-1", "c-2"] },
  { id: "bag-2", sealNumber: "SEAL-2", destinationHubId: "hub-3", consignmentIds: ["c-3"] },
];

const trip = {
  id: "trip-1",
  originHubId: "hub-1",
  destinationHubId: "hub-2",
  departsOn: "2026-09-08",
  vehicleId: "veh-1",
  driverId: "drv-1",
};

describe("the manifest a trip leaves with", () => {
  it("lists every bag with its seal, which is what the far end checks", () => {
    const manifest = manifestFor(trip, bags);

    expect(manifest.bags.map((bag) => bag.sealNumber)).toEqual(["SEAL-1", "SEAL-2"]);
  });

  it("counts the parcels so a discrepancy is visible without opening anything", () => {
    expect(manifestFor(trip, bags).parcelCount).toBe(3);
  });

  it("names the vehicle and the driver, because the manifest is the handover record", () => {
    const manifest = manifestFor(trip, bags);

    expect(manifest.vehicleId).toBe("veh-1");
    expect(manifest.driverId).toBe("drv-1");
  });

  it("flags a bag on board that is not going where the trip is going", () => {
    expect(manifestFor(trip, bags).onwardBagIds).toEqual(["bag-2"]);
  });

  it("refuses a manifest for a trip carrying nothing", () => {
    expect(() => manifestFor(trip, [])).toThrow("a trip carrying nothing has no manifest");
  });
});

describe("checking a manifest at the far end", () => {
  it("agrees when every bag came off", () => {
    const result = reconcile(manifestFor(trip, bags), ["bag-1", "bag-2"]);

    expect(result.agreed).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  it("names a bag that did not come off", () => {
    const result = reconcile(manifestFor(trip, bags), ["bag-1"]);

    expect(result.agreed).toBe(false);
    expect(result.missing).toEqual(["bag-2"]);
  });

  it("names a bag that came off but was never on the manifest", () => {
    const result = reconcile(manifestFor(trip, bags), ["bag-1", "bag-2", "bag-9"]);

    expect(result.agreed).toBe(false);
    expect(result.unexpected).toEqual(["bag-9"]);
  });

  it("counts a bag scanned twice once, because a double scan is not a second bag", () => {
    const result = reconcile(manifestFor(trip, bags), ["bag-1", "bag-1", "bag-2"]);

    expect(result.agreed).toBe(true);
  });
});

describe("a manifest for a trip nobody has crewed", () => {
  it("still lists the bags, so the load can be checked before a driver is found", () => {
    const manifest = manifestFor({ ...trip, vehicleId: undefined, driverId: undefined }, bags);

    expect(manifest.bags).toHaveLength(2);
    expect(manifest.vehicleId).toBeUndefined();
    expect(manifest.driverId).toBeUndefined();
  });

  it("says a bag is unsealed rather than leaving the seal blank", () => {
    const [first] = bags;
    if (first === undefined) throw new Error("the fixture has no bags");
    const manifest = manifestFor(trip, [{ ...first, sealNumber: undefined }]);

    expect(manifest.bags[0]?.sealNumber).toBe("unsealed");
  });
});
