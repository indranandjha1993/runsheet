import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { planningRoutes } from "./routes.js";
import { nearestFirstPlanner } from "../adapters/nearest-first.js";
import {
  countingIds,
  fixedClock,
  inMemoryPlans,
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

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    planningRoutes({
      lookup,
      repository: inMemoryPlans(),
      planner: nearestFirstPlanner(),
      publisher: recordingPublisher(),
      clock: fixedClock("2026-09-07T05:00:00.000Z"),
      ids: countingIds(),
    }),
  );
});

const body = {
  hub_id: "hub-1",
  hub_latitude: 12.9,
  hub_longitude: 77.6,
  date: "2026-09-07",
  vehicles: [{ id: "v1", max_stops: 3, max_weight_grams: 50000, shift_minutes: 480 }],
  jobs: [
    { id: "far", weight_grams: 1000, latitude: 13.1, longitude: 77.6 },
    { id: "near", weight_grams: 1000, latitude: 12.91, longitude: 77.6 },
  ],
};

const post = (
  payload: unknown,
  headers: Record<string, string> = tenant,
): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url: "/v1/plans", headers, body: payload });

interface Plan {
  runs: { stops: { jobId: string }[] }[];
  unassignedJobIds: string[];
}

describe("planning over the api", () => {
  it("returns runs with their stops in order", async () => {
    const response = await post(body);

    expect(response.status).toBe(201);
    expect((response.body as Plan).runs[0]?.stops.map((s) => s.jobId)).toEqual(["near", "far"]);
  });

  it("says what it could not plan, dropping the far outlier rather than whatever came first", async () => {
    const response = await post({
      ...body,
      vehicles: [{ id: "v1", max_stops: 1, max_weight_grams: 50000, shift_minutes: 480 }],
    });

    expect((response.body as Plan).runs[0]?.stops.map((s) => s.jobId)).toEqual(["near"]);
    expect((response.body as Plan).unassignedJobIds).toEqual(["far"]);
  });

  it("applies the default service time when none is given", async () => {
    expect((await post(body)).status).toBe(201);
  });

  it("refuses a plan with no jobs", async () => {
    expect((await post({ ...body, jobs: [] })).status).toBe(400);
  });

  it("refuses a plan with no vehicles", async () => {
    expect((await post({ ...body, vehicles: [] })).status).toBe(400);
  });

  it("refuses a date that is not a date", async () => {
    expect((await post({ ...body, date: "tomorrow" })).status).toBe(400);
  });

  it("refuses a request with no credential", async () => {
    expect((await post(body, {})).status).toBe(401);
  });
});

describe("reading a plan back", () => {
  it("returns what was planned for that hub and day", async () => {
    await post(body);

    const response = await router.handle({
      method: "GET",
      url: "/v1/plans/hub-1/2026-09-07",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it("returns nothing for a day nobody planned", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/plans/hub-1/2026-09-09",
      headers: tenant,
      body: undefined,
    });

    expect(response.body).toHaveLength(0);
  });
});
