import { describe, expect, it } from "vitest";
import { applyToDecision, propose, replayable, type Decision } from "./decision.js";

const at = new Date("2026-09-07T10:00:00.000Z");

const proposed = (): Decision =>
  propose({
    id: "d-1",
    tenantId: "t",
    policyId: "p-1",
    policyVersion: 3,
    codeHash: "abc123",
    autonomy: "act",
    subjectType: "run",
    subjectId: "run-1",
    rolloutBucket: 42,
    rolloutPercent: 50,
    budgetRemaining: 97,
    readAt: [{ topic: "run", partition: 0, offset: 12045 }],
    toolCalls: [
      { tool: "money.settlement.approve", arguments: { lineId: "il-1" }, result: { ok: true } },
    ],
    inputs: { varianceMinor: -500 },
    action: { type: "approve_settlement", settlementId: "s-1" },
    at,
  });

describe("recording a decision", () => {
  it("captures which version of which policy ran", () => {
    const decision = proposed();

    expect(decision.policyVersion).toBe(3);
    expect(decision.codeHash).toBe("abc123");
  });

  it("captures where in the rollout the subject fell", () => {
    expect(proposed().rolloutBucket).toBe(42);
    expect(proposed().rolloutPercent).toBe(50);
  });

  it("captures what the policy read, down to the offset", () => {
    expect(proposed().readAt[0]).toEqual({ topic: "run", partition: 0, offset: 12045 });
  });

  it("captures every tool it called and what came back", () => {
    expect(proposed().toolCalls[0]?.result).toEqual({ ok: true });
  });

  it("refuses a decision that records nothing about what it read", () => {
    expect(() => propose({ ...proposed(), readAt: [], at })).toThrow(
      "a decision must record what it read",
    );
  });

  it("refuses one with no policy version, because a replay could not find the code", () => {
    expect(() => propose({ ...proposed(), codeHash: "", at })).toThrow(
      "a decision must record which code produced it",
    );
  });
});

describe("whether a decision can be replayed", () => {
  it("can be, when everything it depended on was recorded", () => {
    expect(replayable(proposed())).toEqual({ replayable: true, missing: [] });
  });

  it("cannot be, when a tool call recorded no result", () => {
    const incomplete = {
      ...proposed(),
      toolCalls: [{ tool: "x", arguments: {}, result: undefined }],
    };

    expect(replayable(incomplete)).toEqual({
      replayable: false,
      missing: ["tool_result:x"],
    });
  });

  it("cannot be, when a model was involved and its answer was not kept", () => {
    const withModel = { ...proposed(), modelVersion: "some-model", modelExchange: undefined };

    expect(replayable(withModel).missing).toContain("model_exchange");
  });

  it("can be, when a model was involved and the whole exchange was kept", () => {
    const withModel = {
      ...proposed(),
      modelVersion: "some-model",
      modelExchange: { prompt: "why", response: "because", parameters: { temperature: 0 } },
    };

    expect(replayable(withModel).replayable).toBe(true);
  });

  it("lists everything missing at once", () => {
    const bad = {
      ...proposed(),
      modelVersion: "m",
      toolCalls: [{ tool: "a", arguments: {}, result: undefined }],
    };

    expect(replayable(bad).missing).toHaveLength(2);
  });
});

describe("what happens to a decision", () => {
  it("executes and records what it produced", () => {
    const executed = applyToDecision(proposed(), {
      type: "executed",
      producedEventIds: ["e-1", "e-2"],
      at,
    });

    expect(executed.state).toBe("executed");
    expect(executed.producedEventIds).toEqual(["e-1", "e-2"]);
  });

  it("waits for a person when the policy only proposes", () => {
    const cautious = { ...proposed(), autonomy: "propose" as const };

    const approved = applyToDecision(cautious, { type: "approved", by: "u1", at });

    expect(approved.state).toBe("approved");
    expect(applyToDecision(approved, { type: "executed", producedEventIds: [], at }).state).toBe(
      "executed",
    );
  });

  it("will not execute a proposal nobody approved", () => {
    const cautious = { ...proposed(), autonomy: "propose" as const };

    expect(() =>
      applyToDecision(cautious, { type: "executed", producedEventIds: [], at }),
    ).toThrow("a decision this policy only proposes cannot be executed until it is approved");
  });

  it("records a rejection with who said no", () => {
    const rejected = applyToDecision(proposed(), { type: "rejected", by: "u1", reason: "wrong", at });

    expect(rejected.state).toBe("rejected");
  });

  it("records a reversal, which is the signal that matters most", () => {
    const executed = applyToDecision(proposed(), {
      type: "executed",
      producedEventIds: ["e-1"],
      at,
    });

    const reversed = applyToDecision(executed, {
      type: "reversed",
      by: "u1",
      reason: "the count was wrong",
      at,
    });

    expect(reversed.state).toBe("reversed");
    expect(reversed.reversalReason).toBe("the count was wrong");
  });

  it("records a decision the system took but that failed downstream", () => {
    const executed = applyToDecision(proposed(), {
      type: "executed",
      producedEventIds: [],
      at,
    });

    expect(applyToDecision(executed, { type: "failed", reason: "carrier refused", at }).state).toBe(
      "failed",
    );
  });

  it("marks a shadow decision as recorded rather than pretending it acted", () => {
    const shadow = { ...proposed(), shadow: true };

    const recorded = applyToDecision(shadow, { type: "shadow_recorded", wouldHaveDone: "approve", at });

    expect(recorded.state).toBe("shadow_recorded");
  });

  it("will not execute a shadow decision, whatever anyone asks", () => {
    const shadow = { ...proposed(), shadow: true };

    expect(() =>
      applyToDecision(shadow, { type: "executed", producedEventIds: [], at }),
    ).toThrow("a shadow decision never executes");
  });

  it("expires a proposal nobody got to in time", () => {
    const cautious = { ...proposed(), autonomy: "propose" as const };

    expect(applyToDecision(cautious, { type: "expired", at }).state).toBe("expired");
  });

  it("will not reverse something never executed", () => {
    expect(() =>
      applyToDecision(proposed(), { type: "reversed", by: "u", reason: "x", at }),
    ).toThrow("a decision that is proposed cannot be reversed");
  });
});
