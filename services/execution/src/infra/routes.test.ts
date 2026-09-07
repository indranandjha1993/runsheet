import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { executionRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryExecution,
  recordingPublisher,
} from "../application/test-doubles.js";

const tenant = { "x-tenant-id": "01J8Z0T0000000000000000002" };
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

const post = (url: string, body: unknown, headers = tenant): Promise<{ status: number; body: unknown }> =>
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

  it("insists on a tenant", async () => {
    const response = await post("/v1/runs", plan, {});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "tenant_required" } });
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
    expect((await post(events, { type: "force_closed", reason: "device_lost" })).body).toMatchObject(
      { status: "closed" },
    );
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
