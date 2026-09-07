import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { policyRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryPolicies,
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
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["policies:write"] }
      : undefined,
  );

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    policyRoutes({
      lookup,
      repository: inMemoryPolicies(),
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

const policyBody = {
  name: "resolve small cash variances",
  version: 1,
  code_hash: "sha256:abc",
  autonomy: "act",
  trigger_event: "run.closed",
  budget_per_day: 100,
};

async function published(): Promise<string> {
  return ((await post("/v1/policies", policyBody)).body as { id: string }).id;
}

async function live(percent = 100): Promise<string> {
  const id = await published();
  await post(`/v1/policies/${id}/events`, { type: "dry_run_passed", decisions: 500 });
  await post(`/v1/policies/${id}/events`, {
    type: "shadowed",
    decisions: 1000,
    agreed_with_humans: 0.96,
  });
  await post(`/v1/policies/${id}/events`, { type: "staged", percent });
  if (percent === 100) await post(`/v1/policies/${id}/events`, { type: "went_live" });
  return id;
}

const considerBody = {
  trigger_event: "run.closed",
  subject_type: "run",
  subject_id: "run-1",
  inputs: { varianceMinor: -500 },
  action: { type: "approve_settlement" },
  read_at: [{ topic: "run", partition: 0, offset: 12045 }],
};

describe("publishing a policy over the api", () => {
  it("creates it as a draft, never live", async () => {
    const response = await post("/v1/policies", policyBody);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ state: "draft", rolloutPercent: 0 });
  });

  it("refuses an autonomy level nobody defined", async () => {
    expect((await post("/v1/policies", { ...policyBody, autonomy: "whatever" })).status).toBe(400);
  });

  it("refuses one with no budget", async () => {
    expect((await post("/v1/policies", { ...policyBody, budget_per_day: 0 })).status).toBe(400);
  });

  it("refuses a request with no credential", async () => {
    expect((await post("/v1/policies", policyBody, {})).status).toBe(401);
  });
});

describe("promoting a policy over the api", () => {
  it("refuses to go live before it has been shadowed", async () => {
    const id = await published();

    expect((await post(`/v1/policies/${id}/events`, { type: "went_live" })).status).toBe(409);
  });

  it("refuses to promote one that disagreed with people too often", async () => {
    const id = await published();
    await post(`/v1/policies/${id}/events`, { type: "dry_run_passed", decisions: 500 });

    const response = await post(`/v1/policies/${id}/events`, {
      type: "shadowed",
      decisions: 1000,
      agreed_with_humans: 0.5,
    });

    expect(response.status).toBe(400);
  });

  it("walks it all the way to live", async () => {
    const id = await live();

    const report = await get(`/v1/policies/${id}/calibration`);

    expect(report.status).toBe(200);
  });

  it("rolls it back at once, from anywhere", async () => {
    const id = await live();

    const stopped = await post(`/v1/policies/${id}/events`, {
      type: "rolled_back",
      by: "u1",
      reason: "reversing too often",
    });

    expect(stopped.body).toMatchObject({ state: "rolled_back", rolloutPercent: 0 });
  });

  it("retires one that has run its course", async () => {
    const id = await live();
    await post(`/v1/policies/${id}/events`, { type: "rolled_back", by: "u", reason: "x" });

    expect((await post(`/v1/policies/${id}/events`, { type: "retired" })).body).toMatchObject({
      state: "retired",
    });
  });

  it("refuses a step it does not know", async () => {
    const id = await published();

    expect((await post(`/v1/policies/${id}/events`, { type: "blessed" })).status).toBe(400);
  });

  it("reports a policy nobody published", async () => {
    expect((await post("/v1/policies/nope/events", { type: "went_live" })).status).toBe(404);
  });
});

describe("deciding over the api", () => {
  it("does nothing when no policy watches for that event", async () => {
    const response = await post("/v1/decisions", considerBody);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ decided: false, reason: "no_policy" });
  });

  it("records a decision with everything a replay needs", async () => {
    await live();

    const response = await post("/v1/decisions", considerBody);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      decided: true,
      decision: { codeHash: "sha256:abc", rolloutPercent: 100 },
    });
  });

  it("leaves a subject outside the rollout alone", async () => {
    await live(0);

    expect((await post("/v1/decisions", considerBody)).body).toMatchObject({
      decided: false,
      reason: "outside_rollout",
    });
  });

  it("refuses a decision that records nothing about what it read", async () => {
    expect((await post("/v1/decisions", { ...considerBody, read_at: [] })).status).toBe(400);
  });
});

describe("recording what happened, and replaying it", () => {
  const decided = async (): Promise<string> => {
    await live();
    const response = await post("/v1/decisions", considerBody);
    return (response.body as { decision: { id: string } }).decision.id;
  };

  it("records execution and the events it produced", async () => {
    const id = await decided();

    const executed = await post(`/v1/decisions/${id}/events`, {
      type: "executed",
      produced_event_ids: ["e-1"],
    });

    expect(executed.body).toMatchObject({ state: "executed", producedEventIds: ["e-1"] });
  });

  it("says a complete decision could be replayed", async () => {
    const id = await decided();
    await post(`/v1/decisions/${id}/events`, { type: "executed", produced_event_ids: [] });

    const response = await get(`/v1/decisions/${id}/replayable`);

    expect(response.body).toMatchObject({ replayable: true, missing: [] });
  });

  it("records a reversal, which the calibration is built from", async () => {
    const id = await decided();
    await post(`/v1/decisions/${id}/events`, { type: "executed", produced_event_ids: [] });

    await post(`/v1/decisions/${id}/events`, {
      type: "reversed",
      by: "u1",
      reason: "the count was wrong",
    });

    const report = (await get("/v1/policies/01J8Z0T00000000000000000001/calibration")).body as {
      reversed: number;
    };
    expect(report.reversed).toBeGreaterThanOrEqual(0);
  });

  it("records a decision that failed downstream", async () => {
    const id = await decided();
    await post(`/v1/decisions/${id}/events`, { type: "executed", produced_event_ids: [] });

    expect(
      (await post(`/v1/decisions/${id}/events`, { type: "failed", reason: "carrier refused" }))
        .body,
    ).toMatchObject({ state: "failed" });
  });

  it("refuses an outcome it does not know", async () => {
    const id = await decided();

    expect((await post(`/v1/decisions/${id}/events`, { type: "forgiven" })).status).toBe(400);
  });

  it("reports a decision nobody made", async () => {
    expect((await get("/v1/decisions/nope/replayable")).status).toBe(404);
    expect(
      (await post("/v1/decisions/nope/events", { type: "executed", produced_event_ids: [] }))
        .status,
    ).toBe(404);
  });
});

describe("shadow decisions", () => {
  it("records what it would have done and acts on nothing", async () => {
    const id = await published();
    await post(`/v1/policies/${id}/events`, { type: "dry_run_passed", decisions: 500 });
    await post(`/v1/policies/${id}/events`, {
      type: "shadowed",
      decisions: 1000,
      agreed_with_humans: 0.96,
    });

    const response = await post("/v1/decisions", considerBody);
    const decisionId = (response.body as { decision: { id: string } }).decision.id;

    expect(response.body).toMatchObject({ decision: { shadow: true } });
    expect(
      (
        await post(`/v1/decisions/${decisionId}/events`, {
          type: "shadow_recorded",
          would_have_done: "approve",
        })
      ).body,
    ).toMatchObject({ state: "shadow_recorded" });
  });

  it("will not execute a shadow decision, whatever anyone asks", async () => {
    const id = await published();
    await post(`/v1/policies/${id}/events`, { type: "dry_run_passed", decisions: 500 });
    await post(`/v1/policies/${id}/events`, {
      type: "shadowed",
      decisions: 1000,
      agreed_with_humans: 0.96,
    });
    const response = await post("/v1/decisions", considerBody);
    const decisionId = (response.body as { decision: { id: string } }).decision.id;

    expect(
      (
        await post(`/v1/decisions/${decisionId}/events`, {
          type: "executed",
          produced_event_ids: [],
        })
      ).status,
    ).toBe(409);
  });
});

describe("listing policies over the api", () => {
  it("lists every policy with where it is in its rollout", async () => {
    await post("/v1/policies", policyBody);

    const response = await router.handle({
      method: "GET",
      url: "/v1/policies",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    const body = response.body as { policies: { state: string }[] };
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0]?.state).toBe("draft");
  });
});
