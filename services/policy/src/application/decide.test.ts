import { beforeEach, describe, expect, it } from "vitest";
import { calibration, consider, movePolicy, publishPolicy, recordOutcome } from "./decide.js";
import {
  countingIds,
  fixedClock,
  inMemoryPolicies,
  recordingPublisher,
} from "./test-doubles.js";
import type { PolicyDeps } from "./ports.js";
import type { Policy } from "../domain/policy.js";

const tenantId = "01J8Z0T0000000000000000002";
const at = new Date("2026-09-07T10:00:00.000Z");

let deps: PolicyDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(() => {
  deps = {
    repository: inMemoryPolicies(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
  };
});

const policyCommand = {
  tenantId,
  name: "resolve small cash variances",
  version: 1,
  codeHash: "abc123",
  autonomy: "act" as const,
  triggerEvent: "run.closed",
  budgetPerDay: 100,
};

async function promoted(to: "shadow" | "staged" | "live", percent = 100): Promise<Policy> {
  const policy = await publishPolicy(deps, policyCommand);
  const move = (event: Parameters<typeof movePolicy>[1]["event"]): Promise<Policy> =>
    movePolicy(deps, { tenantId, policyId: policy.id, event });

  await move({ type: "dry_run_passed", decisions: 500 });
  const shadowed = await move({ type: "shadowed", decisions: 1000, agreedWithHumans: 0.95 });
  if (to === "shadow") return shadowed;

  const staged = await move({ type: "staged", percent });
  return to === "staged" ? staged : move({ type: "went_live" });
}

const request = {
  tenantId,
  triggerEvent: "run.closed",
  subjectType: "run",
  subjectId: "run-1",
  inputs: { varianceMinor: -500 },
  action: { type: "approve_settlement" },
  readAt: [{ topic: "run", partition: 0, offset: 12045 }],
};

describe("promoting a policy", () => {
  it("walks it from draft to live and announces each step", async () => {
    const live = await promoted("live");

    expect(live.state).toBe("live");
    expect(deps.publisher.published.map((p) => p.event.type)).toEqual([
      "policy.published",
      "policy.dry_run_passed",
      "policy.shadowed",
      "policy.staged",
      "policy.went_live",
    ]);
  });

  it("refuses to promote one that disagreed with people too often", async () => {
    const policy = await publishPolicy(deps, policyCommand);
    await movePolicy(deps, {
      tenantId,
      policyId: policy.id,
      event: { type: "dry_run_passed", decisions: 100 },
    });

    await expect(
      movePolicy(deps, {
        tenantId,
        policyId: policy.id,
        event: { type: "shadowed", decisions: 1000, agreedWithHumans: 0.5 },
      }),
    ).rejects.toThrow(/agree with people/);
  });

  it("reports a policy nobody published", async () => {
    await expect(
      movePolicy(deps, { tenantId, policyId: "nope", event: { type: "went_live" } }),
    ).rejects.toThrow("no policy with that identifier");
  });
});

describe("considering whether to act", () => {
  it("does nothing when no policy watches for that event", async () => {
    expect(await consider(deps, request)).toEqual({ decided: false, reason: "no_policy" });
  });

  it("records what it would have done while shadowed, and acts on nothing", async () => {
    await promoted("shadow");

    const considered = await consider(deps, request);

    expect(considered.decided).toBe(true);
    if (considered.decided) expect(considered.decision.shadow).toBe(true);
  });

  it("acts for a subject inside the rollout", async () => {
    await promoted("live");

    const considered = await consider(deps, request);

    expect(considered.decided).toBe(true);
    if (considered.decided) expect(considered.decision.shadow).toBe(false);
  });

  it("leaves a subject outside the rollout alone, and says why", async () => {
    await promoted("staged", 0);

    expect(await consider(deps, request)).toEqual({ decided: false, reason: "outside_rollout" });
  });

  it("captures everything a replay would need", async () => {
    const policy = await promoted("live");

    const considered = await consider(deps, request);

    if (!considered.decided) throw new Error("expected a decision");
    expect(considered.decision).toMatchObject({
      policyVersion: policy.version,
      codeHash: policy.codeHash,
      rolloutPercent: 100,
      readAt: [{ topic: "run", partition: 0, offset: 12045 }],
      inputs: { varianceMinor: -500 },
    });
  });

  it("stops when the day's budget is spent, rather than running away", async () => {
    const policy = await publishPolicy(deps, { ...policyCommand, budgetPerDay: 2 });
    await movePolicy(deps, { tenantId, policyId: policy.id, event: { type: "dry_run_passed", decisions: 10 } });
    await movePolicy(deps, {
      tenantId,
      policyId: policy.id,
      event: { type: "shadowed", decisions: 1000, agreedWithHumans: 0.99 },
    });
    await movePolicy(deps, { tenantId, policyId: policy.id, event: { type: "staged", percent: 100 } });

    await consider(deps, { ...request, subjectId: "run-1" });
    await consider(deps, { ...request, subjectId: "run-2" });

    expect(await consider(deps, { ...request, subjectId: "run-3" })).toEqual({
      decided: false,
      reason: "budget_spent",
    });
  });

  it("counts down the budget on each decision, so the record shows what was left", async () => {
    await promoted("live");

    const considered = await consider(deps, request);

    if (!considered.decided) throw new Error("expected a decision");
    expect(considered.decision.budgetRemaining).toBe(99);
  });
});

describe("what happened after", () => {
  const decided = async (): Promise<string> => {
    await promoted("live");
    const considered = await consider(deps, request);
    if (!considered.decided) throw new Error("expected a decision");
    return considered.decision.id;
  };

  it("records execution with the events it produced", async () => {
    const id = await decided();

    const executed = await recordOutcome(deps, {
      tenantId,
      decisionId: id,
      event: { type: "executed", producedEventIds: ["e-1"], at },
    });

    expect(executed.state).toBe("executed");
    expect(deps.publisher.published.at(-1)?.event.type).toBe("decision.executed");
  });

  it("records a reversal, which is what the calibration is built from", async () => {
    const id = await decided();
    await recordOutcome(deps, {
      tenantId,
      decisionId: id,
      event: { type: "executed", producedEventIds: [], at },
    });

    const reversed = await recordOutcome(deps, {
      tenantId,
      decisionId: id,
      event: { type: "reversed", by: "u1", reason: "the count was wrong", at },
    });

    expect(reversed.state).toBe("reversed");
  });

  it("reports a decision nobody made", async () => {
    await expect(
      recordOutcome(deps, {
        tenantId,
        decisionId: "nope",
        event: { type: "executed", producedEventIds: [], at },
      }),
    ).rejects.toThrow("no decision with that identifier");
  });
});

describe("reporting how well a policy is calling it", () => {
  it("says there is nothing to judge before anything happened", async () => {
    const policy = await promoted("live");

    const report = await calibration(deps, tenantId, policy.id);

    expect(report.enoughToJudge).toBe(false);
  });

  it("counts reversals against the policy", async () => {
    const policy = await promoted("live");
    for (const subject of ["a", "b", "c", "d"]) {
      const considered = await consider(deps, { ...request, subjectId: subject });
      if (!considered.decided) continue;
      await recordOutcome(deps, {
        tenantId,
        decisionId: considered.decision.id,
        event: { type: "executed", producedEventIds: [], at },
      });
      if (subject === "a") {
        await recordOutcome(deps, {
          tenantId,
          decisionId: considered.decision.id,
          event: { type: "reversed", by: "u", reason: "wrong", at },
        });
      }
    }

    const report = await calibration(deps, tenantId, policy.id);

    expect(report.reversed).toBe(1);
    expect(report.precision).toBeLessThan(1);
  });
});
