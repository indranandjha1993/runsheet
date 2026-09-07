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

describe("the cash ledger over the api", () => {
  const collect = {
    kind: "collected",
    amount_minor: 50000,
    currency: "INR",
    reference: "c-1",
    driver_id: "d-1",
    merchant_id: "m-1",
  };

  const get = (url: string): Promise<{ status: number; body: unknown }> =>
    router.handle({ method: "GET", url, headers: tenant, body: undefined });

  it("records a collection and reports both balances", async () => {
    const response = await post("/v1/cash/movements", collect);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      driver_float_minor: 50000,
      merchant_payable_minor: 50000,
    });
  });

  it("closes a run against what the driver actually handed in", async () => {
    await post("/v1/cash/movements", collect);

    const response = await post("/v1/cash/runs/run-1/close", {
      driver_id: "d-1",
      currency: "INR",
      counted_minor: 45000,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ variance_minor: -5000, float_after_minor: 5000 });
  });

  it("refuses to close the same run twice", async () => {
    await post("/v1/cash/movements", collect);
    const close = { driver_id: "d-1", currency: "INR", counted_minor: 50000 };
    await post("/v1/cash/runs/run-1/close", close);

    expect((await post("/v1/cash/runs/run-1/close", close)).status).toBe(409);
  });

  it("gives a driver their statement in the currency asked for", async () => {
    await post("/v1/cash/movements", collect);

    const response = await get("/v1/cash/drivers/d-1/statement?currency=INR");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ float_minor: 50000, currency: "INR" });
  });

  it("will not guess a currency for a statement", async () => {
    expect((await get("/v1/cash/drivers/d-1/statement")).status).toBe(400);
  });

  it("gives a merchant what they are owed", async () => {
    await post("/v1/cash/movements", collect);

    const response = await get("/v1/cash/merchants/m-1/statement?currency=INR");

    expect(response.body).toMatchObject({ payable_minor: 50000 });
  });

  it("refuses a write-off nobody approved", async () => {
    const response = await post("/v1/cash/movements", {
      kind: "written_off",
      amount_minor: 5000,
      currency: "INR",
      reference: "run-1",
      driver_id: "d-1",
    });

    expect(response.status).toBe(400);
  });
});
