import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { executionRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryExecution,
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
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["runs:write"] }
      : undefined,
  );
const plan = {
  hub_id: "hub-1",
  date: "2026-09-07",
  stops: [
    { sequence: 1, actions: [{ kind: "deliver", consignment_id: "c1" }] },
    { sequence: 2, actions: [{ kind: "pickup", consignment_id: "c2" }] },
  ],
};

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    executionRoutes({
      lookup,
      repository: inMemoryExecution(),
      publisher: recordingPublisher(),
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
      ids: countingIds(),
    }),
  );
});

interface PlannedRun {
  id: string;
  stops: { id: string; actions: { id: string }[] }[];
}

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = tenant,
): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url, headers, body });

async function planned(): Promise<PlannedRun> {
  return (await post("/v1/runs", plan)).body as PlannedRun;
}

describe("planning a run over the api", () => {
  it("returns the run with its stops and their actions", async () => {
    const response = await post("/v1/runs", plan);

    expect(response.status).toBe(201);
    expect((response.body as PlannedRun).stops).toHaveLength(2);
  });

  it("refuses a plan with no stops", async () => {
    expect((await post("/v1/runs", { ...plan, stops: [] })).status).toBe(400);
  });

  it("refuses a date that is not a date", async () => {
    expect((await post("/v1/runs", { ...plan, date: "yesterday" })).status).toBe(400);
  });

  it("refuses a request with no credential", async () => {
    const response = await post("/v1/runs", plan, {});

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: "unauthorised" } });
  });

  it("refuses a credential nobody issued", async () => {
    const response = await post("/v1/runs", plan, { authorization: "Bearer rsk_forged" });

    expect(response.status).toBe(401);
  });

  it("refuses a credential that may only read", async () => {
    const readOnly = createRouter(
      executionRoutes({
        lookup: () =>
          Promise.resolve({ tenantId, keyId: "k2", fingerprint: "def", scopes: ["runs:read"] }),
        repository: inMemoryExecution(),
        publisher: recordingPublisher(),
        clock: fixedClock("2026-09-07T10:00:00.000Z"),
        ids: countingIds(),
      }),
    );

    const response = await readOnly.handle({
      method: "POST",
      url: "/v1/runs",
      headers: tenant,
      body: plan,
    });

    expect(response.status).toBe(403);
  });

  it("ignores a tenant header, so nobody can plan into another account", async () => {
    const response = await post("/v1/runs", plan, {
      ...tenant,
      "x-tenant-id": "01J8Z0T0000000000000000099",
    });
    const run = response.body as { id: string };

    const read = await router.handle({
      method: "GET",
      url: `/v1/runs/${run.id}`,
      headers: tenant,
      body: undefined,
    });

    expect((read.body as { tenantId: string }).tenantId).toBe(tenantId);
  });
});

describe("a shift over the api", () => {
  it("walks assignment, work, and closing with the cash counted", async () => {
    const run = await planned();
    const stop = run.stops[0];
    const events = `/v1/runs/${run.id}/events`;

    await post(events, { type: "assigned", worker_id: "w1", vehicle_id: "v1" });
    await post(events, { type: "started" });
    await post(`/v1/runs/${run.id}/actions`, {
      stop_id: stop?.id,
      action_id: stop?.actions[0]?.id,
      result: "done",
      proof_id: "p1",
      cash_collected_minor: 24990,
    });
    await post(`/v1/runs/${run.id}/actions`, {
      stop_id: run.stops[1]?.id,
      action_id: run.stops[1]?.actions[0]?.id,
      result: "failed",
      ndr_reason: "shipper_closed",
      proof_id: "p2",
    });
    await post(events, { type: "completed" });
    await post(events, { type: "cash_declared", amount_minor: 24990 });
    await post(events, { type: "cash_counted", amount_minor: 24990 });

    expect((await post(events, { type: "closed" })).body).toMatchObject({ status: "closed" });
  });

  it("refuses to close before the cash is counted", async () => {
    const run = await planned();
    const events = `/v1/runs/${run.id}/events`;
    await post(events, { type: "assigned", worker_id: "w", vehicle_id: "v" });
    await post(events, { type: "started" });
    for (const stop of run.stops) {
      await post(`/v1/runs/${run.id}/actions`, {
        stop_id: stop.id,
        action_id: stop.actions[0]?.id,
        result: "done",
        proof_id: "p",
      });
    }
    await post(events, { type: "completed" });

    expect((await post(events, { type: "closed" })).status).toBe(409);
  });

  it("lets a supervisor unassign, suspend, move a stop, and force a close", async () => {
    const run = await planned();
    const events = `/v1/runs/${run.id}/events`;

    await post(events, { type: "assigned", worker_id: "w", vehicle_id: "v" });
    expect((await post(events, { type: "unassigned" })).body).toMatchObject({ status: "planned" });
    await post(events, { type: "assigned", worker_id: "w", vehicle_id: "v" });
    await post(events, { type: "started" });
    expect((await post(events, { type: "suspended", reason: "breakdown" })).body).toMatchObject({
      status: "suspended",
    });
    await post(events, { stop_id: run.stops[1]?.id, to_run_id: "run-2", type: "stop_moved" });
    expect(
      (await post(events, { type: "force_closed", reason: "device_lost" })).body,
    ).toMatchObject({ status: "closed" });
  });

  it("cancels a run nobody has started", async () => {
    const run = await planned();

    expect((await post(`/v1/runs/${run.id}/events`, { type: "cancelled" })).body).toMatchObject({
      status: "cancelled",
    });
  });

  it("refuses an event it does not know", async () => {
    const run = await planned();

    expect((await post(`/v1/runs/${run.id}/events`, { type: "teleported" })).status).toBe(400);
  });

  it("refuses work with no reason when an action failed", async () => {
    const run = await planned();
    const events = `/v1/runs/${run.id}/events`;
    await post(events, { type: "assigned", worker_id: "w", vehicle_id: "v" });
    await post(events, { type: "started" });

    const response = await post(`/v1/runs/${run.id}/actions`, {
      stop_id: run.stops[0]?.id,
      action_id: run.stops[0]?.actions[0]?.id,
      result: "failed",
    });

    expect(response.status).toBe(400);
  });

  it("refuses a malformed action request", async () => {
    const run = await planned();

    expect((await post(`/v1/runs/${run.id}/actions`, { stop_id: "" })).status).toBe(400);
  });

  it("reports a run that does not exist", async () => {
    expect((await post("/v1/runs/nope/events", { type: "started" })).status).toBe(404);
  });
});

describe("proof over the api", () => {
  it("records proof and says whether it met the requirement", async () => {
    const response = await post("/v1/proofs", {
      consignment_id: "c1",
      requirement: "photo_and_otp",
      kinds: ["photo", "otp"],
      media_ids: ["m1"],
      geofence_ok: true,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ satisfiesRequirement: true });
  });

  it("records proof that falls short rather than refusing it", async () => {
    const response = await post("/v1/proofs", {
      consignment_id: "c1",
      requirement: "photo_and_otp",
      kinds: ["photo"],
      media_ids: ["m1"],
    });

    expect(response.body).toMatchObject({ satisfiesRequirement: false });
  });

  it("refuses a requirement nobody defined", async () => {
    const response = await post("/v1/proofs", {
      consignment_id: "c1",
      requirement: "retina_scan",
      kinds: [],
      media_ids: [],
    });

    expect(response.status).toBe(400);
  });

  it("refuses a malformed proof request", async () => {
    expect((await post("/v1/proofs", { consignment_id: "" })).status).toBe(400);
  });
});

describe("reading a run", () => {
  it("returns it in full", async () => {
    const run = await planned();

    const response = await router.handle({
      method: "GET",
      url: `/v1/runs/${run.id}`,
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "planned", hubId: "hub-1" });
  });

  it("reports one that does not exist", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/runs/nope",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(404);
  });
});

describe("hub scanning over the api", () => {
  const scanIn = {
    hub_id: "hub-1",
    worker_id: "w1",
    consignment_id: "c1",
    barcode: "RS0000000013",
    expected: true,
  };

  it("accepts an inscan and reports what it recorded", async () => {
    const response = await post("/v1/hub-scans/in", { ...scanIn, weight_grams: 1500 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ accepted: true, weight_grams: 1500 });
  });

  it("reports the exception on a parcel nobody expected", async () => {
    const response = await post("/v1/hub-scans/in", { ...scanIn, expected: false });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ accepted: true, exception: "unexpected_parcel" });
  });

  it("refuses an outscan for a parcel that is not on the run", async () => {
    const response = await post("/v1/hub-scans/out", {
      hub_id: "hub-1",
      worker_id: "w1",
      consignment_id: "c1",
      barcode: "RS0000000013",
      run_id: "run-1",
      on_run: false,
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: "not_on_this_run" } });
  });

  it("rejects a barcode that is not one of ours", async () => {
    const response = await post("/v1/hub-scans/in", { ...scanIn, barcode: "12345" });

    expect(response.status).toBe(400);
  });

  it("returns the scan history for a parcel", async () => {
    await post("/v1/hub-scans/in", scanIn);
    await post("/v1/hub-scans/in", { ...scanIn, hub_id: "hub-2" });

    const response = await router.handle({
      method: "GET",
      url: "/v1/hub-scans?consignment_id=c1",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect((response.body as { scans: unknown[] }).scans).toHaveLength(2);
  });
});

describe("a handset syncing a shift over the api", () => {
  const batch = {
    device_id: "device-1",
    device_boot_id: "boot-1",
    worker_id: "w1",
    run_id: "run-1",
    batch_id: "batch-1",
    clock: { device_sent_at: "2026-09-07T10:00:00.000Z", device_monotonic_ms: 21600000 },
    entries: [
      {
        command_id: "cmd-1",
        device_sequence: 1,
        type: "stop.completed",
        payload: { stop_id: "s1", consignment_id: "c1" },
        occurred_at_device: "2026-09-07T09:00:00.000Z",
        monotonic_ms: 18000000,
        media: [{ media_id: "m-1", sha256: "a".repeat(64), bytes: 5000, kind: "photo" }],
      },
    ],
  };

  it("takes the batch and reports on every entry", async () => {
    const response = await post("/v1/sync/batches", batch);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      batch_id: "batch-1",
      results: [{ command_id: "cmd-1", status: "accepted" }],
    });
  });

  it("asks for the photograph separately, so nothing waits on it", async () => {
    const response = await post("/v1/sync/batches", batch);

    expect((response.body as { uploads: unknown[] }).uploads).toEqual([
      { media_id: "m-1", sha256: "a".repeat(64) },
    ]);
  });

  it("reports the same work sent twice as already recorded", async () => {
    await post("/v1/sync/batches", batch);

    const again = await post("/v1/sync/batches", { ...batch, batch_id: "batch-2" });

    expect(again.body).toMatchObject({ results: [{ status: "duplicate" }] });
  });

  it("refuses a batch with no entries at all", async () => {
    expect((await post("/v1/sync/batches", { ...batch, entries: [] })).status).toBe(400);
  });

  it("turns away a handset with no credential", async () => {
    expect((await post("/v1/sync/batches", batch, {})).status).toBe(401);
  });
});
