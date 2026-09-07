import { beforeEach, describe, expect, it } from "vitest";
import { captureProof, planRun, recordRunEvent } from "./run-operations.js";
import { countingIds, fixedClock, inMemoryExecution, recordingPublisher } from "./test-doubles.js";
import type { ExecutionDeps } from "./ports.js";

const tenantId = "01J8Z0T0000000000000000002";
const plan = {
  tenantId,
  hubId: "hub-1",
  date: "2026-09-07",
  stops: [
    { sequence: 1, actions: [{ kind: "deliver" as const, consignmentId: "c1" }] },
    { sequence: 2, actions: [{ kind: "deliver" as const, consignmentId: "c2" }] },
  ],
};

let deps: ExecutionDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(() => {
  deps = {
    repository: inMemoryExecution(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
  };
});

describe("planning a run", () => {
  it("creates it with its stops and announces it", async () => {
    const run = await planRun(deps, plan);

    expect(run.status).toBe("planned");
    expect(run.stops).toHaveLength(2);
    expect(deps.publisher.published[0]?.event.type).toBe("run.planned");
    expect(deps.publisher.published[0]?.payload).toMatchObject({ stop_count: 2 });
  });

  it("refuses a run with no stops and announces nothing", async () => {
    await expect(planRun(deps, { ...plan, stops: [] })).rejects.toThrow();

    expect(deps.publisher.published).toHaveLength(0);
  });

  it("lists it among the day's open runs for that hub", async () => {
    await planRun(deps, plan);

    expect(await deps.repository.openRuns(tenantId, "hub-1", "2026-09-07")).toHaveLength(1);
    expect(await deps.repository.openRuns(tenantId, "hub-2", "2026-09-07")).toHaveLength(0);
  });
});

describe("a driver's shift", () => {
  const shift = async (): Promise<{ runId: string; stopIds: string[]; actionIds: string[] }> => {
    const run = await planRun(deps, plan);
    return {
      runId: run.id,
      stopIds: run.stops.map((s) => s.id),
      actionIds: run.stops.flatMap((s) => s.actions.map((a) => a.id)),
    };
  };

  it("goes from assignment to a closed run with the cash counted", async () => {
    const { runId, stopIds, actionIds } = await shift();
    const at = { tenantId, runId };

    await recordRunEvent(deps, {
      ...at,
      event: { type: "assigned", workerId: "w1", vehicleId: "v1" },
    });
    await recordRunEvent(deps, { ...at, event: { type: "started" } });
    await recordRunEvent(deps, {
      ...at,
      event: {
        type: "action_recorded",
        stopId: stopIds[0] ?? "",
        action: {
          actionId: actionIds[0] ?? "",
          result: "done",
          proofId: "p1",
          cashCollectedMinor: 50000,
        },
      },
    });
    await recordRunEvent(deps, {
      ...at,
      event: {
        type: "action_recorded",
        stopId: stopIds[1] ?? "",
        action: {
          actionId: actionIds[1] ?? "",
          result: "failed",
          ndrReason: "nobody_home",
          proofId: "p2",
        },
      },
    });
    await recordRunEvent(deps, { ...at, event: { type: "completed" } });
    await recordRunEvent(deps, { ...at, event: { type: "cash_declared", amountMinor: 50000 } });
    await recordRunEvent(deps, { ...at, event: { type: "cash_counted", amountMinor: 50000 } });
    const closed = await recordRunEvent(deps, { ...at, event: { type: "closed" } });

    expect(closed.status).toBe("closed");
    const lastPayload = deps.publisher.published.at(-1)?.payload as {
      cash: { varianceMinor: number };
    };
    expect(lastPayload.cash.varianceMinor).toBe(0);
  });

  it("reports the shortfall when the count is light", async () => {
    const { runId, stopIds, actionIds } = await shift();
    const at = { tenantId, runId };
    await recordRunEvent(deps, {
      ...at,
      event: { type: "assigned", workerId: "w", vehicleId: "v" },
    });
    await recordRunEvent(deps, { ...at, event: { type: "started" } });
    for (const [index, stopId] of stopIds.entries()) {
      await recordRunEvent(deps, {
        ...at,
        event: {
          type: "action_recorded",
          stopId,
          action: {
            actionId: actionIds[index] ?? "",
            result: "done",
            proofId: "p",
            cashCollectedMinor: 25000,
          },
        },
      });
    }
    await recordRunEvent(deps, { ...at, event: { type: "completed" } });
    await recordRunEvent(deps, { ...at, event: { type: "cash_declared", amountMinor: 49000 } });
    await recordRunEvent(deps, { ...at, event: { type: "cash_counted", amountMinor: 48500 } });

    const closed = await recordRunEvent(deps, { ...at, event: { type: "closed" } });
    const payload = deps.publisher.published.at(-1)?.payload as {
      cash: { collectedMinor: number; varianceMinor: number };
    };

    expect(closed.status).toBe("closed");
    expect(payload.cash).toMatchObject({ collectedMinor: 50000, varianceMinor: -1500 });
  });

  it("refuses to complete while a stop is unresolved, and changes nothing", async () => {
    const { runId } = await shift();
    const at = { tenantId, runId };
    await recordRunEvent(deps, {
      ...at,
      event: { type: "assigned", workerId: "w", vehicleId: "v" },
    });
    await recordRunEvent(deps, { ...at, event: { type: "started" } });

    await expect(recordRunEvent(deps, { ...at, event: { type: "completed" } })).rejects.toThrow(
      /every stop must be resolved/,
    );

    const stored = await deps.repository.runById(tenantId, runId);
    expect(stored?.run.status).toBe("started");
  });

  it("lets a supervisor force a run closed when a device never syncs", async () => {
    const { runId, stopIds, actionIds } = await shift();
    const at = { tenantId, runId };
    await recordRunEvent(deps, {
      ...at,
      event: { type: "assigned", workerId: "w", vehicleId: "v" },
    });
    await recordRunEvent(deps, { ...at, event: { type: "started" } });
    await recordRunEvent(deps, {
      ...at,
      event: {
        type: "action_recorded",
        stopId: stopIds[0] ?? "",
        action: { actionId: actionIds[0] ?? "", result: "done", proofId: "p" },
      },
    });

    const forced = await recordRunEvent(deps, {
      ...at,
      event: { type: "force_closed", reason: "device_lost" },
    });

    expect(forced.status).toBe("closed");
    expect(deps.publisher.published.at(-1)?.payload).toMatchObject({ forced_close: true });
  });

  it("reports a run nobody has", async () => {
    await expect(
      recordRunEvent(deps, { tenantId, runId: "nope", event: { type: "started" } }),
    ).rejects.toThrow("no run with that identifier");
  });

  it("keeps one tenant from touching another's run", async () => {
    const { runId } = await shift();

    await expect(
      recordRunEvent(deps, { tenantId: "other", runId, event: { type: "started" } }),
    ).rejects.toThrow("no run with that identifier");
  });
});

describe("capturing proof", () => {
  it("records it and says whether it met what was required", async () => {
    const proof = await captureProof(deps, {
      tenantId,
      consignmentId: "c1",
      requirement: "photo_and_otp",
      kinds: ["photo", "otp"],
      mediaIds: ["m1"],
    });

    expect(proof.satisfiesRequirement).toBe(true);
    expect(deps.publisher.published[0]?.event.type).toBe("proof.captured");
  });

  it("records proof that falls short rather than refusing it", async () => {
    const proof = await captureProof(deps, {
      tenantId,
      consignmentId: "c1",
      requirement: "photo_and_otp",
      kinds: ["photo"],
      mediaIds: ["m1"],
    });

    expect(proof.satisfiesRequirement).toBe(false);
    expect(deps.publisher.published[0]?.payload).toMatchObject({ satisfies_requirement: false });
  });

  it("carries the media identifiers so uploads can arrive later", async () => {
    await captureProof(deps, {
      tenantId,
      consignmentId: "c1",
      requirement: "photo",
      kinds: ["photo"],
      mediaIds: ["m1", "m2"],
      geofenceOk: true,
    });

    expect(deps.publisher.published[0]?.payload).toMatchObject({ media_ids: ["m1", "m2"] });
  });

  it("can be read back", async () => {
    const proof = await captureProof(deps, {
      tenantId,
      consignmentId: "c1",
      requirement: "none",
      kinds: [],
      mediaIds: [],
    });

    expect((await deps.repository.proofById(tenantId, proof.id))?.consignmentId).toBe("c1");
  });
});
