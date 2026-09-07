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

const post = (url: string, body: unknown, headers = tenant): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url, headers, body });

const get = (url: string): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "GET", url, headers: tenant, body: undefined });

async function carrier(): Promise<string> {
  const response = await post("/v1/carrier-accounts", { name: "Regional Express", currency: "INR" });
  return (response.body as { id: string }).id;
}

interface Reconciled {
  invoiceId: string;
  settlements: { id: string; state: string; reasons: string[] }[];
  alreadyReceived: boolean;
}

async function invoiced(billedMinor = 10080): Promise<Reconciled> {
  const carrierAccountId = await carrier();
  const response = await post("/v1/invoices", {
    carrier_account_id: carrierAccountId,
    number: "INV-1001",
    currency: "INR",
    lines: [{ consignment_id: "c-1", billed_minor: billedMinor, billed_weight_grams: 1200 }],
  });
  return response.body as Reconciled;
}

describe("setting up a carrier and its rates", () => {
  it("creates a carrier account", async () => {
    const response = await post("/v1/carrier-accounts", { name: "Regional", currency: "INR" });

    expect(response.status).toBe(201);
  });

  it("refuses a currency that is not one", async () => {
    expect((await post("/v1/carrier-accounts", { name: "x", currency: "rupees" })).status).toBe(400);
  });

  it("stores a rate card with its bands", async () => {
    const carrierAccountId = await carrier();

    const response = await post("/v1/rate-cards", {
      carrier_account_id: carrierAccountId,
      currency: "INR",
      valid_from: "2026-01-01T00:00:00.000Z",
      lanes: [
        {
          origin: "BLR",
          destination: "HYD",
          service: "next_day",
          bands: [{ up_to_grams: 2000, price_minor: 9000 }],
          surcharges: [{ code: "fuel", percent: 12 }],
        },
      ],
    });

    expect(response.status).toBe(201);
  });

  it("refuses weight bands out of order", async () => {
    const carrierAccountId = await carrier();

    const response = await post("/v1/rate-cards", {
      carrier_account_id: carrierAccountId,
      currency: "INR",
      valid_from: "2026-01-01T00:00:00.000Z",
      lanes: [
        {
          origin: "BLR",
          destination: "HYD",
          service: "next_day",
          bands: [
            { up_to_grams: 2000, price_minor: 9000 },
            { up_to_grams: 500, price_minor: 6000 },
          ],
          surcharges: [],
        },
      ],
    });

    expect(response.status).toBe(400);
  });

  it("refuses a malformed rate card", async () => {
    expect((await post("/v1/rate-cards", { currency: "INR" })).status).toBe(400);
  });
});

describe("receiving an invoice over the api", () => {
  it("settles a clean line without anyone touching it", async () => {
    const result = await invoiced();

    expect(result.settlements[0]?.state).toBe("approved");
  });

  it("holds an overcharge and says why", async () => {
    const result = await invoiced(20000);

    expect(result.settlements[0]?.state).toBe("mismatched");
    expect(result.settlements[0]?.reasons).toContain("billed_above_contract");
  });

  it("returns what it decided before when the carrier resends", async () => {
    const carrierAccountId = await carrier();
    const body = {
      carrier_account_id: carrierAccountId,
      number: "INV-2001",
      currency: "INR",
      lines: [{ consignment_id: "c-1", billed_minor: 10080, billed_weight_grams: 1200 }],
    };
    await post("/v1/invoices", body);

    const again = await post("/v1/invoices", body);

    expect(again.status).toBe(200);
    expect((again.body as Reconciled).alreadyReceived).toBe(true);
  });

  it("refuses an invoice from a carrier nobody set up", async () => {
    const response = await post("/v1/invoices", {
      carrier_account_id: "nope",
      number: "INV-9",
      currency: "INR",
      lines: [{ consignment_id: "c-1", billed_minor: 100, billed_weight_grams: 1 }],
    });

    expect(response.status).toBe(404);
  });

  it("refuses an invoice with no lines", async () => {
    const carrierAccountId = await carrier();

    const response = await post("/v1/invoices", {
      carrier_account_id: carrierAccountId,
      number: "INV-9",
      currency: "INR",
      lines: [],
    });

    expect(response.status).toBe(400);
  });

  it("refuses a request with no credential", async () => {
    expect((await post("/v1/carrier-accounts", { name: "x", currency: "INR" }, {})).status).toBe(401);
  });
});

describe("working a settlement over the api", () => {
  it("disputes, agrees, and pays", async () => {
    const result = await invoiced(20000);
    const id = result.settlements[0]?.id ?? "";

    await post(`/v1/settlements/${id}/events`, {
      type: "disputed",
      by: "u1",
      note: "billed above the contract",
    });
    await post(`/v1/settlements/${id}/events`, {
      type: "dispute_resolved",
      agreed_minor: 10080,
      by: "carrier",
    });
    const paid = await post(`/v1/settlements/${id}/events`, { type: "paid", reference: "utr-1" });

    expect(paid.body).toMatchObject({ state: "paid", agreedMinor: 10080 });
  });

  it("approves a matched line a person must sign for, and records that a person did", async () => {
    // Auto-approval is set below the match tolerance here, so a line can match the contract and
    // still need a signature. That is the shape a finance team wants for larger lines.
    const cautious = createRouter(
      moneyRoutes({
        lookup,
        repository: inMemoryMoney(),
        evidence: knownEvidence(),
        publisher: recordingPublisher(),
        clock: fixedClock("2026-09-30T10:00:00.000Z"),
        ids: countingIds(),
        tolerance: { amountMinor: 100, weightGrams: 50 },
        autoApproveBelowMinor: 10,
      }),
    );
    const send = (url: string, body: unknown): Promise<{ status: number; body: unknown }> =>
      cautious.handle({ method: "POST", url, headers: tenant, body });

    const account = (await send("/v1/carrier-accounts", { name: "R", currency: "INR" })).body as {
      id: string;
    };
    const reconciled = (
      await send("/v1/invoices", {
        carrier_account_id: account.id,
        number: "INV-3001",
        currency: "INR",
        lines: [{ consignment_id: "c-1", billed_minor: 10160, billed_weight_grams: 1200 }],
      })
    ).body as Reconciled;
    expect(reconciled.settlements[0]?.state).toBe("matched");

    const approved = await send(
      `/v1/settlements/${reconciled.settlements[0]?.id ?? ""}/events`,
      { type: "approved", by: "u1" },
    );

    expect(approved.body).toMatchObject({ state: "approved", autoApproved: false });
  });

  it("records a dispute the carrier won", async () => {
    const result = await invoiced(20000);
    const id = result.settlements[0]?.id ?? "";
    await post(`/v1/settlements/${id}/events`, { type: "disputed", by: "u1", note: "checking" });

    const rejected = await post(`/v1/settlements/${id}/events`, {
      type: "dispute_rejected",
      by: "carrier",
    });

    expect(rejected.body).toMatchObject({ state: "approved" });
  });

  it("refuses a step the state machine forbids", async () => {
    const result = await invoiced(20000);
    const id = result.settlements[0]?.id ?? "";

    expect((await post(`/v1/settlements/${id}/events`, { type: "paid", reference: "x" })).status).toBe(
      409,
    );
  });

  it("refuses a dispute with no note", async () => {
    const result = await invoiced(20000);
    const id = result.settlements[0]?.id ?? "";

    expect(
      (await post(`/v1/settlements/${id}/events`, { type: "disputed", by: "u1", note: "" })).status,
    ).toBe(400);
  });

  it("refuses an event it does not know", async () => {
    const result = await invoiced();

    expect(
      (await post(`/v1/settlements/${result.settlements[0]?.id ?? ""}/events`, { type: "forgiven" }))
        .status,
    ).toBe(400);
  });

  it("reports a settlement nobody has", async () => {
    expect((await post("/v1/settlements/nope/events", { type: "approved", by: "u" })).status).toBe(
      404,
    );
  });
});

describe("reading what a carrier is owed", () => {
  it("lists the settlements for an invoice", async () => {
    const result = await invoiced();

    const response = await get(`/v1/invoices/${result.invoiceId}/settlements`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it("reports an invoice nobody sent", async () => {
    expect((await get("/v1/invoices/nope/settlements")).status).toBe(404);
  });
});

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
})
