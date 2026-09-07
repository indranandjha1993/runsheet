import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { ordersRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryOrders,
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
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["consignments:write"] }
      : undefined,
  );
const booking = {
  order_reference: "ORD-3001",
  origin_hub_code: "BLR1",
  destination_hub_code: "DEL3",
  service: "next_day",
  payment_mode: "cod",
  cod_amount_minor: 249900,
  cod_currency: "INR",
  packages: [{ weight_grams: 1200 }],
};

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    ordersRoutes({
      lookup,
      repository: inMemoryOrders(),
      publisher: recordingPublisher(),
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
      ids: countingIds(),
    }),
  );
});

const book = async (body: unknown = booking): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url: "/v1/consignments", headers: tenant, body });

const record = async (id: string, body: unknown): Promise<{ status: number; body: unknown }> =>
  router.handle({
    method: "POST",
    url: `/v1/consignments/${id}/events`,
    headers: tenant,
    body,
  });

const post = async (
  url: string,
  body: unknown,
): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> =>
  router.handle({ method: "POST", url, headers: tenant, body });

async function bookedId(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await book({ ...booking, ...overrides });
  return (response.body as { id: string }).id;
}

function idOf(response: { body: unknown }): string {
  return (response.body as { id: string }).id;
}

describe("booking over the api", () => {
  it("books a consignment and returns where it stands", async () => {
    const response = await book();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "booked" });
  });

  it("insists on the cash amount when payment is on delivery", async () => {
    const response = await book({ ...booking, cod_amount_minor: undefined });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("cod_amount_minor");
  });

  it("refuses a booking with no packages", async () => {
    const response = await book({ ...booking, packages: [] });

    expect(response.status).toBe(400);
  });

  it("applies the defaults a caller did not send", async () => {
    const created = await book({
      ...booking,
      payment_mode: "prepaid",
      cod_amount_minor: undefined,
    });

    const read = await router.handle({
      method: "GET",
      url: `/v1/consignments/${idOf(created)}`,
      headers: tenant,
      body: undefined,
    });

    expect(read.body).toMatchObject({ guards: { attemptLimit: 3, proofRequirement: "photo" } });
  });

  it("refuses a request with no credential", async () => {
    const response = await router.handle({
      method: "POST",
      url: "/v1/consignments",
      headers: {},
      body: booking,
    });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: "unauthorised" } });
  });

  it("refuses a credential nobody issued", async () => {
    const response = await router.handle({
      method: "POST",
      url: "/v1/consignments",
      headers: { authorization: "Bearer rsk_forged" },
      body: booking,
    });

    expect(response.status).toBe(401);
  });

  it("ignores a tenant header, so nobody can book into someone else's account", async () => {
    const response = await router.handle({
      method: "POST",
      url: "/v1/consignments",
      headers: { ...tenant, "x-tenant-id": "01J8Z0T0000000000000000099" },
      body: booking,
    });
    const created = (response.body as { id: string }).id;

    const read = await router.handle({
      method: "GET",
      url: `/v1/consignments/${created}`,
      headers: tenant,
      body: undefined,
    });

    expect((read.body as { tenantId: string }).tenantId).toBe(tenantId);
  });

  it("refuses a credential without the scope the route needs", async () => {
    const readOnly = createRouter(
      ordersRoutes({
        lookup: () =>
          Promise.resolve({
            tenantId,
            keyId: "k2",
            fingerprint: "def",
            scopes: ["consignments:read"],
          }),
        repository: inMemoryOrders(),
        publisher: recordingPublisher(),
        clock: fixedClock("2026-09-07T10:00:00.000Z"),
        ids: countingIds(),
      }),
    );

    const response = await readOnly.handle({
      method: "POST",
      url: "/v1/consignments",
      headers: tenant,
      body: booking,
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "forbidden" } });
  });
});

describe("recording events over the api", () => {
  it("walks a consignment to delivery", async () => {
    const id = idOf(await book());

    await record(id, { type: "picked_up" });
    await record(id, { type: "out_for_delivery", run_id: "run-1" });
    const delivered = await record(id, {
      type: "delivered",
      proof_id: "p1",
      cash_collected_minor: 249900,
    });

    expect(delivered.body).toMatchObject({ status: "delivered" });
  });

  it("refuses a delivery with no cash on a cash-on-delivery consignment", async () => {
    const id = idOf(await book());
    await record(id, { type: "picked_up" });
    await record(id, { type: "out_for_delivery", run_id: "run-1" });

    const response = await record(id, { type: "delivered", proof_id: "p1" });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("cash on delivery must be collected");
  });

  it("refuses a transition out of order as a conflict", async () => {
    const id = idOf(await book());

    const response = await record(id, { type: "delivered", proof_id: "p1" });

    expect(response.status).toBe(409);
  });

  it("rejects an event type it does not know", async () => {
    const id = idOf(await book());

    expect((await record(id, { type: "teleported" })).status).toBe(400);
  });

  it("insists on a reason when an attempt failed", async () => {
    const id = idOf(await book());

    expect((await record(id, { type: "attempted", ndr_reason: "", proof_id: "p" })).status).toBe(
      400,
    );
  });

  it("carries the hub through an inscan and the run through a dispatch", async () => {
    const id = idOf(await book());
    await record(id, { type: "picked_up" });

    await record(id, { type: "inscanned", hub_id: "hub-1" });
    const out = await record(id, { type: "out_for_delivery", run_id: "run-2" });

    expect(out.body).toMatchObject({ status: "out_for_delivery" });
  });

  it("records a damage flag without moving the consignment", async () => {
    const id = idOf(await book());
    await record(id, { type: "picked_up" });

    const response = await record(id, { type: "damaged", note: "crushed" });

    expect(response.body).toMatchObject({ status: "picked_up" });
  });

  it("walks a return through to the shipper", async () => {
    const id = idOf(await book());
    await record(id, { type: "picked_up" });
    await record(id, { type: "rto_initiated" });
    await record(id, { type: "rto_out_for_delivery", run_id: "run-r" });

    const returned = await record(id, { type: "rto_delivered", proof_id: "p2" });

    expect(returned.body).toMatchObject({ status: "rto_delivered" });
  });

  it("handles a lost parcel being found", async () => {
    const id = idOf(await book());
    await record(id, { type: "picked_up" });
    await record(id, { type: "lost" });

    expect((await record(id, { type: "found", hub_id: "hub-9" })).body).toMatchObject({
      status: "in_hub",
    });
  });

  it("cancels a consignment nobody has collected", async () => {
    const id = idOf(await book());

    expect((await record(id, { type: "cancelled" })).body).toMatchObject({ status: "cancelled" });
  });

  it("records a cancellation requested too late as a flag", async () => {
    const id = idOf(await book());
    await record(id, { type: "picked_up" });

    expect((await record(id, { type: "cancel_requested" })).status).toBe(200);
  });

  it("records a failed pickup", async () => {
    const id = idOf(await book());

    const response = await record(id, {
      type: "pickup_attempted",
      ndr_reason: "shipper_not_ready",
      proof_id: "p",
    });

    expect(response.body).toMatchObject({ status: "booked" });
  });

  it("records departure from a hub", async () => {
    const id = idOf(await book());
    await record(id, { type: "picked_up" });
    await record(id, { type: "inscanned", hub_id: "hub-1" });

    expect((await record(id, { type: "departed_hub" })).body).toMatchObject({
      status: "in_transit",
    });
  });
});

describe("reading a consignment", () => {
  it("returns it with everything the caller needs", async () => {
    const id = idOf(await book());

    const response = await router.handle({
      method: "GET",
      url: `/v1/consignments/${id}`,
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "booked", paymentMode: "cod" });
  });

  it("reports one that does not exist", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/consignments/01J8Z0T0000000000000000099",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(404);
  });
});

describe("printing labels over the api", () => {
  const print = {
    origin: { hub_code: "BLR1", city: "Bengaluru" },
    destination: {
      hub_code: "DEL3",
      name: "Aarav Sharma",
      line: "Flat 402, Sunrise Apartments",
      city: "Noida",
      postcode: "201309",
    },
    sort_code: "DEL3-N-04",
    service_level: "next_day",
  };

  it("returns one label for each package", async () => {
    const id = await bookedId({ packages: [{ weight_grams: 1200 }, { weight_grams: 800 }] });

    const response = await post(`/v1/consignments/${id}/labels`, print);

    expect(response.status).toBe(200);
    expect((response.body as { labels: unknown[] }).labels).toHaveLength(2);
  });

  it("returns printer commands when the caller asks for them", async () => {
    const id = await bookedId();

    const response = await post(`/v1/consignments/${id}/labels`, { ...print, format: "zpl" });

    expect(response.headers?.["content-type"]).toBe("application/vnd.zebra.zpl");
    expect(String(response.body).startsWith("^XA")).toBe(true);
  });

  it("refuses to label a consignment that does not exist", async () => {
    const response = await post("/v1/consignments/01J8Z0T0000000000000000099/labels", print);

    expect(response.status).toBe(404);
  });

  it("refuses a request that names no destination", async () => {
    const id = await bookedId();

    const response = await post(`/v1/consignments/${id}/labels`, { ...print, destination: {} });

    expect(response.status).toBe(400);
  });
});

describe("listing consignments over the api", () => {
  it("lists what is still moving, for a board to show", async () => {
    await bookedId();
    await bookedId({ order_reference: "ORD-3002" });

    const response = await router.handle({
      method: "GET",
      url: "/v1/consignments?limit=10",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect((response.body as { consignments: unknown[] }).consignments).toHaveLength(2);
  });

  it("never lists more than a screen can use in one go", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/consignments?limit=99999",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
  });
});
