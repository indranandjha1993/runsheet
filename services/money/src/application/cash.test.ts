import { beforeEach, describe, expect, it } from "vitest";
import { closeDriverRun, recordMovement, statementFor } from "./cash.js";
import type { MoneyDeps } from "./ports.js";
import { testDeps } from "./test-doubles.js";

let deps: MoneyDeps & { publisher: { published: { event: { type: string } }[] } };

beforeEach(() => {
  deps = testDeps();
});

const collection = {
  tenantId: "t",
  kind: "collected" as const,
  amountMinor: 50000,
  currency: "INR",
  driverId: "d-1",
  merchantId: "m-1",
  reference: "c-1",
};

describe("recording a cash movement", () => {
  it("returns the balances the movement produced", async () => {
    const result = await recordMovement(deps, collection);

    expect(result.driverFloatMinor).toBe(50000);
    expect(result.merchantPayableMinor).toBe(50000);
  });

  it("announces it so the rest of the platform can react", async () => {
    await recordMovement(deps, collection);

    expect(deps.publisher.published.map((p) => p.event.type)).toEqual(["cash.collected"]);
  });

  it("counts the same collection once however many times it is delivered", async () => {
    await recordMovement(deps, collection);
    await recordMovement(deps, collection);

    const statement = await statementFor(deps, { tenantId: "t", driverId: "d-1", currency: "INR" });
    expect(statement.floatMinor).toBe(50000);
  });

  it("treats a collection for a different consignment as a different movement", async () => {
    await recordMovement(deps, collection);
    await recordMovement(deps, { ...collection, reference: "c-2" });

    const statement = await statementFor(deps, { tenantId: "t", driverId: "d-1", currency: "INR" });
    expect(statement.floatMinor).toBe(100000);
  });
});

describe("a driver's statement", () => {
  it("shows what they are still holding and what they collected today", async () => {
    await recordMovement(deps, collection);
    await recordMovement(deps, { ...collection, reference: "c-2", amountMinor: 30000 });
    await recordMovement(deps, {
      ...collection,
      kind: "deposited",
      reference: "run-1",
      amountMinor: 60000,
    });

    const statement = await statementFor(deps, { tenantId: "t", driverId: "d-1", currency: "INR" });

    expect(statement.floatMinor).toBe(20000);
    expect(statement.entries).toHaveLength(3);
  });
});

describe("closing a driver's run", () => {
  it("banks what was counted and leaves nothing outstanding when it all adds up", async () => {
    await recordMovement(deps, collection);

    const close = await closeDriverRun(deps, {
      tenantId: "t",
      runId: "run-1",
      driverId: "d-1",
      currency: "INR",
      countedMinor: 50000,
    });

    expect(close.varianceMinor).toBe(0);
    expect(close.floatAfterMinor).toBe(0);
  });

  it("leaves a short driver still owing, rather than quietly writing it off", async () => {
    await recordMovement(deps, collection);

    const close = await closeDriverRun(deps, {
      tenantId: "t",
      runId: "run-1",
      driverId: "d-1",
      currency: "INR",
      countedMinor: 45000,
    });

    expect(close.varianceMinor).toBe(-5000);
    expect(close.floatAfterMinor).toBe(5000);
    expect(deps.publisher.published.map((p) => p.event.type)).toContain("cash.shortfall_found");
  });

  it("writes off a shortfall only when somebody approves it", async () => {
    await recordMovement(deps, collection);
    await closeDriverRun(deps, {
      tenantId: "t",
      runId: "run-1",
      driverId: "d-1",
      currency: "INR",
      countedMinor: 45000,
    });

    await recordMovement(deps, {
      tenantId: "t",
      kind: "written_off",
      amountMinor: 5000,
      currency: "INR",
      driverId: "d-1",
      reference: "run-1",
      approvedBy: "supervisor-1",
    });

    const statement = await statementFor(deps, { tenantId: "t", driverId: "d-1", currency: "INR" });
    expect(statement.floatMinor).toBe(0);
  });

  it("refuses a write-off nobody approved", async () => {
    await expect(
      recordMovement(deps, {
        tenantId: "t",
        kind: "written_off",
        amountMinor: 5000,
        currency: "INR",
        driverId: "d-1",
        reference: "run-1",
      }),
    ).rejects.toThrow("a write-off needs an approver");
  });

  it("records an over-count as a surplus rather than silently keeping it", async () => {
    await recordMovement(deps, collection);

    const close = await closeDriverRun(deps, {
      tenantId: "t",
      runId: "run-1",
      driverId: "d-1",
      currency: "INR",
      countedMinor: 55000,
    });

    expect(close.varianceMinor).toBe(5000);
    expect(close.floatAfterMinor).toBe(-5000);
    expect(deps.publisher.published.map((p) => p.event.type)).toContain("cash.surplus_found");
  });

  it("refuses to close a run twice, because the deposit would be counted twice", async () => {
    await recordMovement(deps, collection);
    const close = {
      tenantId: "t",
      runId: "run-1",
      driverId: "d-1",
      currency: "INR",
      countedMinor: 50000,
    };
    await closeDriverRun(deps, close);

    await expect(closeDriverRun(deps, close)).rejects.toThrow(
      "that run is already closed for cash",
    );
  });
});

describe("paying a merchant", () => {
  it("clears what they were owed", async () => {
    await recordMovement(deps, collection);
    await recordMovement(deps, {
      tenantId: "t",
      kind: "remitted",
      amountMinor: 50000,
      currency: "INR",
      merchantId: "m-1",
      reference: "payout-1",
    });

    const statement = await statementFor(deps, {
      tenantId: "t",
      merchantId: "m-1",
      currency: "INR",
    });
    expect(statement.payableMinor).toBe(0);
  });

  it("refuses to pay out more than is owed", async () => {
    await recordMovement(deps, collection);

    await expect(
      recordMovement(deps, {
        tenantId: "t",
        kind: "remitted",
        amountMinor: 60000,
        currency: "INR",
        merchantId: "m-1",
        reference: "payout-1",
      }),
    ).rejects.toThrow("that is more than the merchant is owed");
  });
});
