import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { exceptionsRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryExceptions,
  recordingPublisher,
} from "../application/test-doubles.js";
import type { Exception } from "../domain/exception.js";

const tenantId = "01J8Z0T0000000000000000002";
const tenant = { authorization: "Bearer rsk_test" };

const lookup = (
  presented: string,
): Promise<
  { tenantId: string; keyId: string; fingerprint: string; scopes: string[] } | undefined
> =>
  Promise.resolve(
    presented === "rsk_test"
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["runs:write"] }
      : undefined,
  );

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    exceptionsRoutes({
      lookup,
      repository: inMemoryExceptions(),
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

const get = (
  url: string,
  headers: Record<string, string> = tenant,
): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "GET", url, headers, body: undefined });

const variance = {
  type: "run.closed",
  aggregate_id: "run-1",
  payload: { cash: { varianceMinor: -2500 } },
};

async function raised(): Promise<Exception> {
  const response = await post("/v1/observations", variance);
  return (response.body as { exception: Exception }).exception;
}

describe("observing what the network reports", () => {
  it("raises an exception and says it did", async () => {
    const response = await post("/v1/observations", variance);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ raised: true });
  });

  it("says nothing was raised when the same thing is reported again", async () => {
    await post("/v1/observations", variance);

    const again = await post("/v1/observations", variance);

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ raised: false, reason: "already_open" });
  });

  it("says nothing was raised for an event it does not watch", async () => {
    const response = await post("/v1/observations", {
      type: "run.started",
      aggregate_id: "run-1",
    });

    expect(response.body).toMatchObject({ reason: "no_rule" });
  });

  it("refuses a malformed observation", async () => {
    expect((await post("/v1/observations", { type: "" })).status).toBe(400);
  });

  it("refuses a request with no credential", async () => {
    expect((await post("/v1/observations", variance, {})).status).toBe(401);
  });
});

describe("working an exception over the api", () => {
  it("assigns and resolves it", async () => {
    const exception = await raised();

    await post(`/v1/exceptions/${exception.id}/events`, { type: "assigned", to: "u1" });
    const resolved = await post(`/v1/exceptions/${exception.id}/events`, {
      type: "resolved",
      by: "u1",
      note: "recounted",
    });

    expect(resolved.body).toMatchObject({ state: "resolved" });
  });

  it("refuses a resolution with no note", async () => {
    const exception = await raised();

    const response = await post(`/v1/exceptions/${exception.id}/events`, {
      type: "resolved",
      by: "u1",
      note: "",
    });

    expect(response.status).toBe(400);
  });

  it("refuses a step the state machine forbids", async () => {
    const exception = await raised();

    expect(
      (await post(`/v1/exceptions/${exception.id}/events`, { type: "reopened", reason: "x" }))
        .status,
    ).toBe(409);
  });

  it("pauses and resumes the clock", async () => {
    const exception = await raised();

    expect(
      (await post(`/v1/exceptions/${exception.id}/events`, { type: "waiting_on_customer" })).status,
    ).toBe(200);
    expect(
      (await post(`/v1/exceptions/${exception.id}/events`, { type: "customer_answered" })).status,
    ).toBe(200);
  });

  it("refuses an event it does not know", async () => {
    const exception = await raised();

    expect((await post(`/v1/exceptions/${exception.id}/events`, { type: "vanished" })).status).toBe(
      400,
    );
  });

  it("reports one nobody raised", async () => {
    expect((await post("/v1/exceptions/nope/events", { type: "triaged", by: "u" })).status).toBe(
      404,
    );
  });
});

describe("reading the queue", () => {
  it("returns what is open", async () => {
    await raised();

    const response = await get("/v1/exceptions");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it("filters to one severity", async () => {
    await raised();
    await post("/v1/observations", {
      type: "consignment.damaged",
      aggregate_id: "c-1",
      payload: {},
    });

    expect((await get("/v1/exceptions?severity=high")).body).toHaveLength(1);
    expect((await get("/v1/exceptions?severity=low")).body).toHaveLength(0);
  });

  it("ignores a severity nobody defined rather than failing", async () => {
    await raised();

    expect((await get("/v1/exceptions?severity=catastrophic")).body).toHaveLength(1);
  });

  it("returns one exception in full", async () => {
    const exception = await raised();

    expect((await get(`/v1/exceptions/${exception.id}`)).body).toMatchObject({
      type: "cash_variance",
    });
  });

  it("reports one that does not exist", async () => {
    expect((await get("/v1/exceptions/nope")).status).toBe(404);
  });
});
