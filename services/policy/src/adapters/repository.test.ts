import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresPolicy } from "./repository.js";
import { applyToPolicy, publish } from "../domain/policy.js";
import { applyToDecision, propose, type Decision } from "../domain/decision.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_policy",
});
const repository = postgresPolicy(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";
const at = new Date("2026-09-07T10:00:00.000Z");

const policy = () =>
  publish({
    id: "01J8Z0T0000000000000000010",
    tenantId,
    name: "resolve small cash variances",
    version: 1,
    codeHash: "abc123",
    autonomy: "act",
    triggerEvent: "run.closed",
    budgetPerDay: 100,
  });

const decision = (id = "01J8Z0T0000000000000000020", subjectId = "run-1"): Decision =>
  propose({
    id,
    tenantId,
    policyId: policy().id,
    policyVersion: 1,
    codeHash: "abc123",
    autonomy: "act",
    subjectType: "run",
    subjectId,
    rolloutBucket: 42,
    rolloutPercent: 100,
    budgetRemaining: 99,
    readAt: [{ topic: "run", partition: 0, offset: 12045 }],
    toolCalls: [{ tool: "money.approve", arguments: { lineId: "il-1" }, result: { ok: true } }],
    inputs: { varianceMinor: -500 },
    action: { type: "approve_settlement" },
    at,
  });

beforeEach(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS decisions, policies, aggregate_streams, schema_migrations CASCADE",
  );
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("the policy repository", () => {
  it("round-trips a policy", async () => {
    await repository.savePolicy(policy());

    expect(await repository.policyById(tenantId, policy().id)).toEqual(policy());
  });

  it("round-trips one that was promoted and then rolled back", async () => {
    const stopped = applyToPolicy(
      applyToPolicy(policy(), { type: "dry_run_passed", decisions: 500 }),
      { type: "rolled_back", by: "u1", reason: "wrong calls" },
    );

    await repository.savePolicy(stopped);

    expect(await repository.policyById(tenantId, policy().id)).toEqual(stopped);
  });

  it("refuses two policies with the same name and version", async () => {
    await repository.savePolicy(policy());

    await expect(
      repository.savePolicy({ ...policy(), id: "01J8Z0T0000000000000000011" }),
    ).rejects.toThrow();
  });

  it("refuses a rollout that is not a percentage", async () => {
    await expect(
      repository.savePolicy({ ...policy(), rolloutPercent: 150 }),
    ).rejects.toThrow();
  });

  it("finds the policies watching for an event, newest version first", async () => {
    await repository.savePolicy(policy());
    await repository.savePolicy({ ...policy(), id: "01J8Z0T0000000000000000011", version: 2 });

    const found = await repository.policiesFor(tenantId, "run.closed");

    expect(found.map((p) => p.version)).toEqual([2, 1]);
    expect(await repository.policiesFor(tenantId, "run.started")).toHaveLength(0);
  });

  it("keeps one tenant's policies invisible to another", async () => {
    await repository.savePolicy(policy());

    expect(await repository.policyById("other", policy().id)).toBeUndefined();
  });
});

describe("the decision ledger", () => {
  beforeEach(async () => {
    await repository.savePolicy(policy());
  });

  it("round-trips a decision with everything a replay needs", async () => {
    await repository.saveDecision(decision());

    expect(await repository.decisionById(tenantId, decision().id)).toEqual(decision());
  });

  it("round-trips one that recorded a model exchange", async () => {
    const withModel: Decision = {
      ...decision(),
      modelVersion: "some-model",
      modelExchange: { prompt: "why", response: "because", parameters: { temperature: 0 } },
    };

    await repository.saveDecision(withModel);

    expect(await repository.decisionById(tenantId, decision().id)).toEqual(withModel);
  });

  it("round-trips one that executed and one that was reversed", async () => {
    const executed = applyToDecision(decision(), {
      type: "executed",
      producedEventIds: ["e-1", "e-2"],
      at,
    });
    await repository.saveDecision(executed);
    expect((await repository.decisionById(tenantId, decision().id))?.producedEventIds).toEqual([
      "e-1",
      "e-2",
    ]);

    const reversed = applyToDecision(executed, {
      type: "reversed",
      by: "u1",
      reason: "the count was wrong",
      at,
    });
    await repository.saveDecision(reversed);

    expect(await repository.decisionById(tenantId, decision().id)).toEqual(reversed);
  });

  it("refuses one policy to decide twice about the same subject", async () => {
    await repository.saveDecision(decision());

    await expect(
      repository.saveDecision(decision("01J8Z0T0000000000000000021", "run-1")),
    ).rejects.toThrow();
  });

  it("allows a shadow decision alongside a real one, because it changed nothing", async () => {
    await repository.saveDecision(decision());

    await expect(
      repository.saveDecision({
        ...decision("01J8Z0T0000000000000000021", "run-1"),
        shadow: true,
        state: "shadow_recorded",
      }),
    ).resolves.toBeUndefined();
  });

  it("counts what a policy has decided today, for the budget", async () => {
    await repository.saveDecision(decision());
    await repository.saveDecision(decision("01J8Z0T0000000000000000021", "run-2"));

    expect(
      await repository.decisionsToday(tenantId, policy().id, new Date("2026-09-07T00:00:00.000Z")),
    ).toBe(2);
    expect(
      await repository.decisionsToday(tenantId, policy().id, new Date("2026-09-08T00:00:00.000Z")),
    ).toBe(0);
  });

  it("lists a policy's decisions for the calibration report", async () => {
    await repository.saveDecision(decision());

    expect(await repository.decisionsFor(tenantId, policy().id)).toHaveLength(1);
    expect(await repository.decisionsFor("other", policy().id)).toHaveLength(0);
  });

  it("hands out stream positions that never repeat", async () => {
    expect([
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "a"),
    ]).toEqual([1, 2]);
  });
});
