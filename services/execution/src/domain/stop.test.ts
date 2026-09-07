import { describe, expect, it } from "vitest";
import { outcomeOf, plannedStop, recordAction, type Stop } from "./stop.js";

const stop = (): Stop =>
  plannedStop({
    id: "stop-1",
    sequence: 1,
    actions: [
      { id: "a1", kind: "deliver", consignmentId: "c1" },
      { id: "a2", kind: "deliver", consignmentId: "c2" },
    ],
  });

describe("a stop", () => {
  it("starts pending with every action unresolved", () => {
    expect(stop().state).toBe("pending");
    expect(outcomeOf(stop())).toBe("pending");
  });

  it("refuses a stop with nothing to do", () => {
    expect(() => plannedStop({ id: "s", sequence: 1, actions: [] })).toThrow(
      "a stop needs at least one action",
    );
  });

  it("is completed once every action succeeded", () => {
    let current = recordAction(stop(), { actionId: "a1", result: "done", proofId: "p1" });
    current = recordAction(current, { actionId: "a2", result: "done", proofId: "p2" });

    expect(outcomeOf(current)).toBe("completed");
  });

  it("is partially completed when some succeeded and some did not", () => {
    let current = recordAction(stop(), { actionId: "a1", result: "done", proofId: "p1" });
    current = recordAction(current, {
      actionId: "a2",
      result: "failed",
      ndrReason: "refused",
      proofId: "p2",
    });

    expect(outcomeOf(current)).toBe("partially_completed");
  });

  it("is failed when nothing at the stop succeeded", () => {
    let current = recordAction(stop(), {
      actionId: "a1",
      result: "failed",
      ndrReason: "nobody_home",
      proofId: "p1",
    });
    current = recordAction(current, {
      actionId: "a2",
      result: "failed",
      ndrReason: "nobody_home",
      proofId: "p2",
    });

    expect(outcomeOf(current)).toBe("failed");
  });

  it("insists on a reason when an action fails", () => {
    expect(() =>
      recordAction(stop(), { actionId: "a1", result: "failed", ndrReason: "", proofId: "p" }),
    ).toThrow("a failed action needs a reason");
  });

  it("insists on a proof record when an action is done", () => {
    expect(() => recordAction(stop(), { actionId: "a1", result: "done" })).toThrow(
      "a completed action needs a proof",
    );
  });

  it("refuses an action it does not have", () => {
    expect(() =>
      recordAction(stop(), { actionId: "nope", result: "done", proofId: "p" }),
    ).toThrow("this stop has no action nope");
  });

  it("refuses to record the same action twice", () => {
    const once = recordAction(stop(), { actionId: "a1", result: "done", proofId: "p1" });

    expect(() => recordAction(once, { actionId: "a1", result: "done", proofId: "p2" })).toThrow(
      "action a1 already has an outcome",
    );
  });

  it("can be skipped before anything is attempted, with a reason", () => {
    const skipped = recordAction(stop(), { actionId: "a1", result: "skipped", ndrReason: "road_closed" });

    expect(skipped.actions[0]?.result).toBe("skipped");
  });

  it("counts a stop where everything was skipped as skipped", () => {
    let current = recordAction(stop(), { actionId: "a1", result: "skipped", ndrReason: "closed" });
    current = recordAction(current, { actionId: "a2", result: "skipped", ndrReason: "closed" });

    expect(outcomeOf(current)).toBe("skipped");
  });
});

describe("skipping", () => {
  it("insists on a reason when an action is skipped", () => {
    expect(() =>
      recordAction(stop(), { actionId: "a1", result: "skipped" }),
    ).toThrow("a skipped action needs a reason");
  });

  it("records the cash a driver collected at the door", () => {
    const done = recordAction(stop(), {
      actionId: "a1",
      result: "done",
      proofId: "p1",
      cashCollectedMinor: 24990,
    });

    expect(done.actions[0]?.cashCollectedMinor).toBe(24990);
  });
});
