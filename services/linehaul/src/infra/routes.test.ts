import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { linehaulRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryLinehaul,
  recordingPublisher,
} from "../application/test-doubles.js";

const tenantId = "01J8Z0T0000000000000000002";
const tenant = { authorization: "Bearer rsk_test" };

const lookup = (
  presented: string,
): Promise<
  { tenantId: string; keyId: string; fingerprint: string; scopes: string[] } | undefined
> =>
  Promise.resolve(
    presented === "rsk_test"
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["linehaul:write"] }
      : undefined,
  );

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    linehaulRoutes({
      lookup,
      repository: inMemoryLinehaul(),
      publisher: recordingPublisher(),
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
      ids: countingIds(),
    }),
  );
});

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = tenant,
): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url, headers, body });

const get = (url: string): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "GET", url, headers: tenant, body: undefined });

const lane = { origin_hub_id: "hub-1", destination_hub_id: "hub-2" };

async function bagged(consignmentId = "c-1"): Promise<string> {
  const response = await post("/v1/bags/parcels", { ...lane, consignment_id: consignmentId });
  return (response.body as { id: string }).id;
}

async function readyTrip(): Promise<string> {
  const planned = await post("/v1/trips", {
    ...lane,
    departs_on: "2026-09-08",
    capacity_bags: 2,
  });
  const id = (planned.body as { id: string }).id;
  await post(`/v1/trips/${id}/events`, {
    type: "crewed",
    vehicle_id: "veh-1",
    driver_id: "drv-1",
  });
  return id;
}

describe("bagging over the api", () => {
  it("puts a parcel in a bag and returns the bag", async () => {
    const response = await post("/v1/bags/parcels", { ...lane, consignment_id: "c-1" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "open", consignment_ids: ["c-1"] });
  });

  it("refuses a bag going to the hub it is already in", async () => {
    const response = await post("/v1/bags/parcels", {
      origin_hub_id: "hub-1",
      destination_hub_id: "hub-1",
      consignment_id: "c-1",
    });

    expect(response.status).toBe(400);
  });

  it("seals a bag", async () => {
    const id = await bagged();

    const response = await post(`/v1/bags/${id}/seal`, { seal_number: "SEAL-1" });

    expect(response.body).toMatchObject({ status: "sealed", seal_number: "SEAL-1" });
  });

  it("refuses to seal a bag that is not there", async () => {
    expect((await post("/v1/bags/missing/seal", { seal_number: "SEAL-1" })).status).toBe(404);
  });

  it("reads a bag back", async () => {
    const id = await bagged();

    expect((await get(`/v1/bags/${id}`)).body).toMatchObject({ consignment_ids: ["c-1"] });
  });

  it("turns away a caller with no credential", async () => {
    const response = await post("/v1/bags/parcels", { ...lane, consignment_id: "c-1" }, {});

    expect(response.status).toBe(401);
  });

  it("ignores a header naming another tenant", async () => {
    const response = await post(
      "/v1/bags/parcels",
      { ...lane, consignment_id: "c-1" },
      { ...tenant, "x-tenant-id": "somebody-else" },
    );

    expect(response.status).toBe(201);
    expect((await get(`/v1/bags/${(response.body as { id: string }).id}`)).status).toBe(200);
  });
});

describe("trips over the api", () => {
  it("plans a trip", async () => {
    const response = await post("/v1/trips", {
      ...lane,
      departs_on: "2026-09-08",
      capacity_bags: 2,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "planned" });
  });

  it("loads a sealed bag onto a crewed trip", async () => {
    const bagId = await bagged();
    await post(`/v1/bags/${bagId}/seal`, { seal_number: "SEAL-1" });
    const tripId = await readyTrip();

    const response = await post(`/v1/trips/${tripId}/bags`, { bag_id: bagId });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ bag_ids: [bagId] });
  });

  it("refuses to load a bag nobody sealed", async () => {
    const bagId = await bagged();
    const tripId = await readyTrip();

    expect((await post(`/v1/trips/${tripId}/bags`, { bag_id: bagId })).status).toBe(409);
  });

  it("gives the driver a manifest to hand over", async () => {
    const bagId = await bagged();
    await post(`/v1/bags/${bagId}/seal`, { seal_number: "SEAL-1" });
    const tripId = await readyTrip();
    await post(`/v1/trips/${tripId}/bags`, { bag_id: bagId });

    const response = await get(`/v1/trips/${tripId}/manifest`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ parcelCount: 1, tripId });
  });

  it("refuses a manifest for a trip carrying nothing", async () => {
    const tripId = await readyTrip();

    expect((await get(`/v1/trips/${tripId}/manifest`)).status).toBe(400);
  });

  it("runs a trip through to close and names what did not come off", async () => {
    const bagId = await bagged();
    await post(`/v1/bags/${bagId}/seal`, { seal_number: "SEAL-1" });
    const tripId = await readyTrip();
    await post(`/v1/trips/${tripId}/bags`, { bag_id: bagId });
    await post(`/v1/trips/${tripId}/events`, { type: "departed" });
    await post(`/v1/trips/${tripId}/events`, { type: "arrived", hub_id: "hub-2" });

    const response = await post(`/v1/trips/${tripId}/events`, {
      type: "closed",
      received_bag_ids: [],
    });

    expect(response.body).toMatchObject({ status: "closed", missing_bag_ids: [bagId] });
  });

  it("refuses a trip event it does not know", async () => {
    const tripId = await readyTrip();

    expect((await post(`/v1/trips/${tripId}/events`, { type: "teleported" })).status).toBe(400);
  });
});

describe("receiving at the far end", () => {
  it("reports the parcels that were not in the bag", async () => {
    const bagId = await bagged("c-1");
    await post("/v1/bags/parcels", { ...lane, consignment_id: "c-2" });
    await post(`/v1/bags/${bagId}/seal`, { seal_number: "SEAL-1" });
    const tripId = await readyTrip();
    await post(`/v1/trips/${tripId}/bags`, { bag_id: bagId });
    await post(`/v1/bags/${bagId}/events`, {
      type: "received",
      hub_id: "hub-2",
      seal_intact: true,
    });

    const response = await post(`/v1/bags/${bagId}/events`, {
      type: "emptied",
      scanned_ids: ["c-1"],
    });

    expect(response.body).toMatchObject({ missing_consignment_ids: ["c-2"] });
  });

  it("records a bag received at the wrong hub as misrouted rather than turning it away", async () => {
    const bagId = await bagged();
    await post(`/v1/bags/${bagId}/seal`, { seal_number: "SEAL-1" });
    const tripId = await readyTrip();
    await post(`/v1/trips/${tripId}/bags`, { bag_id: bagId });

    const response = await post(`/v1/bags/${bagId}/events`, {
      type: "received",
      hub_id: "hub-9",
      seal_intact: true,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ misrouted: true });
  });
});

describe("changing a trip's mind before it leaves", () => {
  it("takes a bag back off a trip that has not departed", async () => {
    const bagId = await bagged();
    await post(`/v1/bags/${bagId}/seal`, { seal_number: "SEAL-1" });
    const tripId = await readyTrip();
    await post(`/v1/trips/${tripId}/bags`, { bag_id: bagId });

    const response = await post(`/v1/trips/${tripId}/events`, {
      type: "bag_unloaded",
      bag_id: bagId,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ bag_ids: [] });
  });

  it("cancels a trip that has not left, with the reason on it", async () => {
    const tripId = await readyTrip();

    const response = await post(`/v1/trips/${tripId}/events`, {
      type: "cancelled",
      reason: "vehicle broke down",
    });

    expect(response.body).toMatchObject({ status: "cancelled" });
  });

  it("refuses to cancel a trip that is already on the road", async () => {
    const bagId = await bagged();
    await post(`/v1/bags/${bagId}/seal`, { seal_number: "SEAL-1" });
    const tripId = await readyTrip();
    await post(`/v1/trips/${tripId}/bags`, { bag_id: bagId });
    await post(`/v1/trips/${tripId}/events`, { type: "departed" });

    const response = await post(`/v1/trips/${tripId}/events`, {
      type: "cancelled",
      reason: "changed our mind",
    });

    expect(response.status).toBe(409);
  });

  it("refuses a cancellation with no reason", async () => {
    const tripId = await readyTrip();

    expect((await post(`/v1/trips/${tripId}/events`, { type: "cancelled" })).status).toBe(400);
  });
});

describe("changing a bag's mind before it is sealed", () => {
  it("takes a parcel back out of an open bag", async () => {
    const bagId = await bagged("c-1");
    await post("/v1/bags/parcels", { ...lane, consignment_id: "c-2" });

    const response = await post(`/v1/bags/${bagId}/events`, {
      type: "parcel_removed",
      consignment_id: "c-1",
    });

    expect(response.body).toMatchObject({ consignment_ids: ["c-2"] });
  });

  it("refuses to take a parcel out of a sealed bag", async () => {
    const bagId = await bagged();
    await post(`/v1/bags/${bagId}/seal`, { seal_number: "SEAL-1" });

    const response = await post(`/v1/bags/${bagId}/events`, {
      type: "parcel_removed",
      consignment_id: "c-1",
    });

    expect(response.status).toBe(409);
  });

  it("refuses a bag event it does not know", async () => {
    const bagId = await bagged();

    expect((await post(`/v1/bags/${bagId}/events`, { type: "incinerated" })).status).toBe(400);
  });
});

describe("listing what is waiting at a hub", () => {
  it("lists the bags open or sealed at a hub", async () => {
    await bagged("c-1");
    const other = await post("/v1/bags/parcels", {
      origin_hub_id: "hub-9",
      destination_hub_id: "hub-2",
      consignment_id: "c-2",
    });
    expect(other.status).toBe(201);

    const response = await get("/v1/bags?hub_id=hub-1");

    expect(response.status).toBe(200);
    expect((response.body as { bags: unknown[] }).bags).toHaveLength(1);
  });

  it("insists on a hub", async () => {
    expect((await get("/v1/bags")).status).toBe(400);
  });

  it("lists the trips that have not closed", async () => {
    await readyTrip();

    const response = await get("/v1/trips");

    expect(response.status).toBe(200);
    expect((response.body as { trips: unknown[] }).trips).toHaveLength(1);
  });
});

describe("the edges of the linehaul api", () => {
  it("refuses a parcel with no destination", async () => {
    expect(
      (await post("/v1/bags/parcels", { origin_hub_id: "hub-1", consignment_id: "c-1" })).status,
    ).toBe(400);
  });

  it("refuses a seal with no number", async () => {
    const id = await bagged();

    expect((await post(`/v1/bags/${id}/seal`, {})).status).toBe(400);
  });

  it("refuses a trip with no capacity", async () => {
    expect((await post("/v1/trips", { ...lane, departs_on: "2026-09-08" })).status).toBe(400);
  });

  it("reports a bag that is not there", async () => {
    expect((await get("/v1/bags/nowhere")).status).toBe(404);
  });
});
