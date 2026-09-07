import { describe, expect, it } from "vitest";
import { applyToException, keyOf, raise, severityOf, type Exception } from "./exception.js";

const at = new Date("2026-09-07T10:00:00.000Z");

const raised = (): Exception =>
  raise({
    id: "exc-1",
    tenantId: "t",
    type: "cash_short",
    subjectType: "run",
    subjectId: "run-1",
    detail: { shortfallMinor: 2500 },
    at,
  });

describe("raising an exception", () => {
  it("starts open with an sla clock running", () => {
    const exception = raised();

    expect(exception.state).toBe("raised");
    expect(exception.clock.allowanceMinutes).toBeGreaterThan(0);
  });

  it("gives money problems a tighter deadline than address ones", () => {
    const cash = raise({ ...raised(), type: "cash_short", at });
    const address = raise({ ...raised(), type: "address_unclear", at });

    expect(cash.clock.allowanceMinutes).toBeLessThan(address.clock.allowanceMinutes);
  });

  it("refuses a type nobody defined", () => {
    expect(() => raise({ ...raised(), type: "aliens", at })).toThrow(
      "unknown exception type: aliens",
    );
  });

  it("carries a severity so a queue can be sorted without reading every one", () => {
    expect(severityOf("cash_short")).toBe("high");
    expect(severityOf("address_unclear")).toBe("low");
  });

  it("has a key that is the same for the same problem on the same subject", () => {
    expect(keyOf(raised())).toBe(keyOf({ ...raised(), id: "exc-2" }));
    expect(keyOf(raised())).not.toBe(keyOf({ ...raised(), subjectId: "run-2" }));
  });
});

describe("working an exception", () => {
  it("goes from raised to resolved", () => {
    let current = applyToException(raised(), { type: "assigned", to: "u1", at });
    current = applyToException(current, { type: "resolved", by: "u1", note: "counted again", at });

    expect(current.state).toBe("resolved");
    expect(current.resolvedBy).toBe("u1");
  });

  it("can be assigned straight from raised, without triage", () => {
    expect(applyToException(raised(), { type: "assigned", to: "u1", at }).assignedTo).toBe("u1");
  });

  it("can be triaged first when nobody knows who should hold it", () => {
    const triaged = applyToException(raised(), { type: "triaged", by: "u1", at });

    expect(triaged.state).toBe("triaged");
    expect(applyToException(triaged, { type: "assigned", to: "u2", at }).assignedTo).toBe("u2");
  });

  it("can be reopened when the resolution did not hold", () => {
    let current = applyToException(raised(), { type: "assigned", to: "u1", at });
    current = applyToException(current, { type: "resolved", by: "u1", note: "done", at });

    const reopened = applyToException(current, { type: "reopened", reason: "happened again", at });

    expect(reopened.state).toBe("raised");
    expect(reopened.reopenCount).toBe(1);
  });

  it("will not resolve something already resolved", () => {
    const resolved = applyToException(
      applyToException(raised(), { type: "assigned", to: "u1", at }),
      { type: "resolved", by: "u1", note: "done", at },
    );

    expect(() =>
      applyToException(resolved, { type: "resolved", by: "u2", note: "again", at }),
    ).toThrow("an exception that is resolved cannot be resolved");
  });

  it("insists on a note when resolving, so the next person knows what was done", () => {
    const assigned = applyToException(raised(), { type: "assigned", to: "u1", at });

    expect(() => applyToException(assigned, { type: "resolved", by: "u1", note: "", at })).toThrow(
      "a resolution needs a note",
    );
  });

  it("records a breach as a flag, so an overdue exception is still open", () => {
    const late = new Date("2026-09-07T23:00:00.000Z");
    const overdue = applyToException(raised(), { type: "sla_checked", at: late });

    expect(overdue.slaBreached).toBe(true);
    expect(overdue.state).toBe("raised");
  });

  it("pauses the clock while waiting on someone outside the operation", () => {
    const waiting = applyToException(raised(), { type: "waiting_on_customer", at });
    const late = new Date("2026-09-07T23:00:00.000Z");

    expect(applyToException(waiting, { type: "sla_checked", at: late }).slaBreached).toBe(false);
  });

  it("resumes the clock when the customer answers", () => {
    let current = applyToException(raised(), { type: "waiting_on_customer", at });
    current = applyToException(current, {
      type: "customer_answered",
      at: new Date("2026-09-07T12:00:00.000Z"),
    });

    const late = new Date("2026-09-08T00:00:00.000Z");
    expect(applyToException(current, { type: "sla_checked", at: late }).slaBreached).toBe(true);
  });

  it("can be resolved by a policy rather than a person, and says so", () => {
    const auto = applyToException(raised(), {
      type: "auto_resolved",
      by: "policy:cash-variance",
      note: "within tolerance",
      at,
    });

    expect(auto.state).toBe("resolved");
    expect(auto.resolvedAutomatically).toBe(true);
  });
});
