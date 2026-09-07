import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { moneyRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryMoney,
  knownEvidence,
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
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["money:write"] }
      : undefined,
  );

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    moneyRoutes({
      lookup,
      repository: inMemoryMoney(),
      evidence: knownEvidence(),
      publisher: recordingPublisher(),
      clock: fixedClock("2026-09-30T10:00:00.000Z"),
      ids: countingIds(),
      tolerance: { amountMinor: 100, weightGrams: 50 },
      autoApproveBelowMinor: 500,
    }),
  );
});

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = tenant,
): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url, headers, body });

describe("listing invoices and settlements over the api", () => {
  it("lists nothing before any invoice arrived", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/invoices",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect((response.body as { invoices: unknown[] }).invoices).toEqual([]);
  });

  it("lists settlements by the state a queue is worked in", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/settlements?state=mismatched",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect((response.body as { settlements: unknown[] }).settlements).toEqual([]);
  });

  it("refuses a state it does not know", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/settlements?state=lost",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(400);
  });
});

describe("the edges of the money api", () => {
  it("takes a rate card that expires", async () => {
    const carrier = await post("/v1/carrier-accounts", { name: "Swift", currency: "INR" });
    const id = (carrier.body as { id: string }).id;

    const response = await post("/v1/rate-cards", {
      carrier_account_id: id,
      currency: "INR",
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_until: "2026-12-31T00:00:00.000Z",
      lanes: [
        {
          origin: "BLR1",
          destination: "DEL3",
          service: "express",
          bands: [{ up_to_grams: 2000, price_minor: 10080 }],
        },
      ],
    });

    expect(response.status).toBe(201);
  });

  it("refuses a cash movement with no amount", async () => {
    expect((await post("/v1/cash/movements", { kind: "collected" })).status).toBe(400);
  });

  it("takes an approved write-off over the api", async () => {
    await post("/v1/cash/movements", {
      kind: "collected",
      amount_minor: 5000,
      currency: "INR",
      reference: "c-1",
      driver_id: "d-1",
      merchant_id: "m-1",
    });

    const response = await post("/v1/cash/movements", {
      kind: "written_off",
      amount_minor: 5000,
      currency: "INR",
      reference: "run-1",
      driver_id: "d-1",
      approved_by: "supervisor",
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ driver_float_minor: 0 });
  });

  it("refuses to close a run without a count", async () => {
    expect((await post("/v1/cash/runs/run-1/close", { driver_id: "d-1" })).status).toBe(400);
  });
});
