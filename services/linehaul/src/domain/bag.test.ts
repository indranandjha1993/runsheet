import { describe, expect, it } from "vitest";
import { apply, openBag, type Bag } from "./bag.js";

const opened = (): Bag =>
  openBag({
    id: "bag-1",
    tenantId: "t",
    originHubId: "hub-1",
    destinationHubId: "hub-2",
  });

const withParcels = (count = 2): Bag => {
  let bag = opened();
  for (let n = 1; n <= count; n += 1) {
    bag = apply(bag, { type: "parcel_added", consignmentId: `c-${String(n)}` });
  }
  return bag;
};

const sealed = (): Bag => apply(withParcels(), { type: "sealed", sealNumber: "SEAL-9001" });

describe("filling a bag", () => {
  it("starts open and empty", () => {
    expect(opened().status).toBe("open");
    expect(opened().consignmentIds).toEqual([]);
  });

  it("takes parcels one at a time", () => {
    expect(withParcels(3).consignmentIds).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("ignores a parcel already in it, because scanning twice is normal on a floor", () => {
    const bag = apply(withParcels(1), { type: "parcel_added", consignmentId: "c-1" });

    expect(bag.consignmentIds).toEqual(["c-1"]);
  });

  it("lets a parcel be taken back out before the bag is sealed", () => {
    const bag = apply(withParcels(2), { type: "parcel_removed", consignmentId: "c-1" });

    expect(bag.consignmentIds).toEqual(["c-2"]);
  });

  it("refuses a bag going nowhere", () => {
    expect(() =>
      openBag({ id: "b", tenantId: "t", originHubId: "hub-1", destinationHubId: "hub-1" }),
    ).toThrow("a bag cannot travel to the hub it is in");
  });
});

describe("sealing a bag", () => {
  it("records the seal so a broken one is visible on arrival", () => {
    expect(sealed().status).toBe("sealed");
    expect(sealed().sealNumber).toBe("SEAL-9001");
  });

  it("refuses to seal an empty bag, because there is nothing to send", () => {
    expect(() => apply(opened(), { type: "sealed", sealNumber: "SEAL-9001" })).toThrow(
      "an empty bag cannot be sealed",
    );
  });

  it("refuses a parcel added after the seal", () => {
    expect(() => apply(sealed(), { type: "parcel_added", consignmentId: "c-9" })).toThrow(
      "a sealed bag cannot be opened to add a parcel",
    );
  });

  it("refuses a parcel removed after the seal", () => {
    expect(() => apply(sealed(), { type: "parcel_removed", consignmentId: "c-1" })).toThrow(
      "a sealed bag cannot be opened to remove a parcel",
    );
  });

  it("refuses a second seal, because the first one is the one in the record", () => {
    expect(() => apply(sealed(), { type: "sealed", sealNumber: "SEAL-9002" })).toThrow(
      "that bag is already sealed",
    );
  });
});

describe("moving a bag", () => {
  it("goes in transit when it is loaded onto a trip", () => {
    const bag = apply(sealed(), { type: "loaded", tripId: "trip-1" });

    expect(bag.status).toBe("in_transit");
    expect(bag.tripId).toBe("trip-1");
  });

  it("refuses to load a bag nobody sealed", () => {
    expect(() => apply(withParcels(), { type: "loaded", tripId: "trip-1" })).toThrow(
      "only a sealed bag can be loaded",
    );
  });

  it("refuses to load a bag that is already on a trip", () => {
    const loaded = apply(sealed(), { type: "loaded", tripId: "trip-1" });

    expect(() => apply(loaded, { type: "loaded", tripId: "trip-2" })).toThrow(
      "that bag is already on a trip",
    );
  });

  it("is received at the hub it was sent to", () => {
    const bag = apply(apply(sealed(), { type: "loaded", tripId: "trip-1" }), {
      type: "received",
      hubId: "hub-2",
      sealIntact: true,
    });

    expect(bag.status).toBe("received");
    expect(bag.sealBroken).toBe(false);
  });

  it("is still received at the wrong hub, because the bag is physically there", () => {
    const bag = apply(apply(sealed(), { type: "loaded", tripId: "trip-1" }), {
      type: "received",
      hubId: "hub-9",
      sealIntact: true,
    });

    expect(bag.status).toBe("received");
    expect(bag.misrouted).toBe(true);
  });

  it("remembers a broken seal, because every parcel in it now needs checking", () => {
    const bag = apply(apply(sealed(), { type: "loaded", tripId: "trip-1" }), {
      type: "received",
      hubId: "hub-2",
      sealIntact: false,
    });

    expect(bag.sealBroken).toBe(true);
  });
});

describe("emptying a bag", () => {
  const received = (): Bag =>
    apply(apply(sealed(), { type: "loaded", tripId: "trip-1" }), {
      type: "received",
      hubId: "hub-2",
      sealIntact: true,
    });

  it("is empty once every parcel has been taken out", () => {
    const bag = apply(received(), { type: "emptied", scannedIds: ["c-1", "c-2"] });

    expect(bag.status).toBe("emptied");
    expect(bag.missingIds).toEqual([]);
  });

  it("names the parcels that were not in it, so somebody goes looking", () => {
    const bag = apply(received(), { type: "emptied", scannedIds: ["c-1"] });

    expect(bag.missingIds).toEqual(["c-2"]);
  });

  it("names parcels that were in it but should not have been", () => {
    const bag = apply(received(), { type: "emptied", scannedIds: ["c-1", "c-2", "c-9"] });

    expect(bag.unexpectedIds).toEqual(["c-9"]);
  });

  it("refuses to empty a bag nobody received", () => {
    expect(() => apply(sealed(), { type: "emptied", scannedIds: [] })).toThrow(
      "only a received bag can be emptied",
    );
  });
});
