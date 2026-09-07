import { describe, expect, it } from "vitest";
import { applyToPolicy, inRollout, publish, type Policy } from "./policy.js";

const draft = (): Policy =>
  publish({
    id: "p-1",
    tenantId: "t",
    name: "resolve small cash variances",
    version: 1,
    codeHash: "abc123",
    autonomy: "act",
    triggerEvent: "run.closed",
    budgetPerDay: 100,
  });

describe("publishing a policy", () => {
  it("starts as a draft, never live", () => {
    expect(draft().state).toBe("draft");
  });

  it("refuses an autonomy level nobody defined", () => {
    expect(() => publish({ ...draft(), autonomy: "whatever" as never })).toThrow(
      "unknown autonomy level: whatever",
    );
  });

  it("refuses a policy with no budget, because a runaway must stop itself", () => {
    expect(() => publish({ ...draft(), budgetPerDay: 0 })).toThrow("a policy needs a daily budget");
  });

  it("refuses one with no code hash, because a replay must know what ran", () => {
    expect(() => publish({ ...draft(), codeHash: "" })).toThrow(
      "a policy version needs a code hash",
    );
  });
});

describe("the road from draft to live", () => {
  it("goes draft, dry run, shadow, staged, live", () => {
    let current = applyToPolicy(draft(), { type: "dry_run_passed", decisions: 412 });
    current = applyToPolicy(current, { type: "shadowed", decisions: 1200, agreedWithHumans: 0.94 });
    current = applyToPolicy(current, { type: "staged", percent: 10 });
    current = applyToPolicy(current, { type: "staged", percent: 50 });
    current = applyToPolicy(current, { type: "went_live" });

    expect(current.state).toBe("live");
    expect(current.rolloutPercent).toBe(100);
  });

  it("will not go live without being shadowed first", () => {
    const dryRun = applyToPolicy(draft(), { type: "dry_run_passed", decisions: 10 });

    expect(() => applyToPolicy(dryRun, { type: "went_live" })).toThrow(
      "a policy that is dry_run cannot go live",
    );
  });

  it("will not be shadowed until it has been run against history", () => {
    expect(() =>
      applyToPolicy(draft(), { type: "shadowed", decisions: 10, agreedWithHumans: 1 }),
    ).toThrow("a policy that is draft cannot be shadowed");
  });

  it("refuses to promote a policy that disagreed with people too often", () => {
    const dryRun = applyToPolicy(draft(), { type: "dry_run_passed", decisions: 10 });

    expect(() =>
      applyToPolicy(dryRun, { type: "shadowed", decisions: 1000, agreedWithHumans: 0.4 }),
    ).toThrow("a policy must agree with people on at least 90% of decisions");
  });

  it("refuses to shadow on too few decisions to mean anything", () => {
    const dryRun = applyToPolicy(draft(), { type: "dry_run_passed", decisions: 10 });

    expect(() =>
      applyToPolicy(dryRun, { type: "shadowed", decisions: 5, agreedWithHumans: 1 }),
    ).toThrow("a policy needs at least 100 shadow decisions before it is promoted");
  });

  it("refuses a rollout percentage outside nought to a hundred", () => {
    const shadowed = applyToPolicy(
      applyToPolicy(draft(), { type: "dry_run_passed", decisions: 10 }),
      { type: "shadowed", decisions: 1000, agreedWithHumans: 0.95 },
    );

    expect(() => applyToPolicy(shadowed, { type: "staged", percent: 150 })).toThrow(
      "a rollout must be between 0 and 100 percent",
    );
  });

  it("can be rolled back from anywhere, instantly", () => {
    const live = applyToPolicy(
      applyToPolicy(applyToPolicy(draft(), { type: "dry_run_passed", decisions: 10 }), {
        type: "shadowed",
        decisions: 1000,
        agreedWithHumans: 0.95,
      }),
      { type: "staged", percent: 50 },
    );

    const stopped = applyToPolicy(live, { type: "rolled_back", by: "u1", reason: "wrong calls" });

    expect(stopped.state).toBe("rolled_back");
    expect(stopped.rolloutPercent).toBe(0);
  });

  it("cannot be brought back without going through the whole road again", () => {
    const stopped = applyToPolicy(draft(), { type: "rolled_back", by: "u1", reason: "no" });

    expect(() => applyToPolicy(stopped, { type: "went_live" })).toThrow(
      "a policy that is rolled_back cannot go live",
    );
  });
});

describe("retiring a policy", () => {
  it("retires one that has run its course", () => {
    const live = applyToPolicy(
      applyToPolicy(
        applyToPolicy(applyToPolicy(draft(), { type: "dry_run_passed", decisions: 10 }), {
          type: "shadowed",
          decisions: 1000,
          agreedWithHumans: 0.95,
        }),
        { type: "staged", percent: 100 },
      ),
      { type: "went_live" },
    );

    const retired = applyToPolicy(live, { type: "retired" });

    expect(retired.state).toBe("retired");
    expect(retired.rolloutPercent).toBe(0);
  });

  it("retires one that was rolled back, so it stops appearing in the list", () => {
    const stopped = applyToPolicy(draft(), { type: "rolled_back", by: "u", reason: "no" });

    expect(applyToPolicy(stopped, { type: "retired" }).state).toBe("retired");
  });
});

describe("who a staged policy applies to", () => {
  const staged = (percent: number): Policy => ({
    ...draft(),
    state: "staged",
    rolloutPercent: percent,
  });

  it("applies to nobody at nought percent", () => {
    expect(inRollout(staged(0), "subject-1")).toBe(false);
  });

  it("applies to everybody at a hundred percent", () => {
    expect(inRollout(staged(100), "subject-1")).toBe(true);
  });

  it("gives the same answer for the same subject every time", () => {
    const first = inRollout(staged(50), "subject-1");

    expect(inRollout(staged(50), "subject-1")).toBe(first);
    expect(inRollout(staged(50), "subject-1")).toBe(first);
  });

  it("spreads roughly evenly across subjects", () => {
    const included = Array.from({ length: 1000 }, (_v, i) =>
      inRollout(staged(30), `subject-${String(i)}`),
    ).filter(Boolean).length;

    expect(included).toBeGreaterThan(200);
    expect(included).toBeLessThan(400);
  });

  it("never applies when the policy is not staged or live", () => {
    expect(inRollout(draft(), "subject-1")).toBe(false);
  });
});
