import { beforeEach, describe, expect, it } from "vitest";
import { observe } from "./watch.js";
import { work } from "./work.js";
import { countingIds, fixedClock, inMemoryExceptions, recordingPublisher } from "./test-doubles.js";
import type { ExceptionsDeps } from "./ports.js";

const tenantId = "01J8Z0T0000000000000000002";
const at = new Date("2026-09-07T10:00:00.000Z");

let deps: ExceptionsDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(() => {
  deps = {
    repository: inMemoryExceptions(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
  };
});

const closedWithVariance = {
  tenantId,
  type: "run.closed",
  aggregateId: "run-1",
  payload: { cash: { collectedMinor: 50000, countedMinor: 47500, varianceMinor: -2500 } },
};

describe("watching what the network reports", () => {
  it("raises an exception when a run closes with a cash variance", async () => {
    const observed = await observe(deps, closedWithVariance);

    expect(observed.raised).toBe(true);
    expect(observed.exception?.type).toBe("cash_variance");
    expect(observed.exception?.severity).toBe("high");
    expect(deps.publisher.published[0]?.event.type).toBe("exception.raised");
  });

  it("stays quiet when the cash counted matches", async () => {
    const observed = await observe(deps, {
      ...closedWithVariance,
      payload: { cash: { varianceMinor: 0 } },
    });

    expect(observed.raised).toBe(false);
    expect(observed.reason).toBe("rule_did_not_apply");
  });

  it("stays quiet about an event nothing watches for", async () => {
    const observed = await observe(deps, {
      tenantId,
      type: "run.started",
      aggregateId: "run-1",
      payload: {},
    });

    expect(observed.reason).toBe("no_rule");
  });

  it("raises the same problem once, however many times the event is replayed", async () => {
    await observe(deps, closedWithVariance);
    const again = await observe(deps, closedWithVariance);

    expect(again.raised).toBe(false);
    expect(again.reason).toBe("already_open");
    expect(await deps.repository.queue(tenantId)).toHaveLength(1);
  });

  it("raises it again once the first was resolved and the problem recurs", async () => {
    const first = await observe(deps, closedWithVariance);
    await work(deps, {
      tenantId,
      exceptionId: first.exception?.id ?? "",
      event: { type: "resolved", by: "u1", note: "recounted", at },
    });

    expect((await observe(deps, closedWithVariance)).raised).toBe(true);
  });

  it("keeps the same problem on different runs apart", async () => {
    await observe(deps, closedWithVariance);
    await observe(deps, { ...closedWithVariance, aggregateId: "run-2" });

    expect(await deps.repository.queue(tenantId)).toHaveLength(2);
  });

  it("keeps one tenant's exceptions out of another's", async () => {
    await observe(deps, closedWithVariance);
    await observe(deps, { ...closedWithVariance, tenantId: "other" });

    expect(await deps.repository.queue(tenantId)).toHaveLength(1);
  });

  it("notices a run forced closed because a device never synced", async () => {
    const observed = await observe(deps, {
      tenantId,
      type: "run.force_closed",
      aggregateId: "run-9",
      payload: { forced_close: true },
    });

    expect(observed.exception?.type).toBe("device_never_synced");
  });

  it("notices a failed delivery attempt", async () => {
    const observed = await observe(deps, {
      tenantId,
      type: "consignment.attempted",
      aggregateId: "c-1",
      payload: { ndr_reason: "customer_unavailable" },
    });

    expect(observed.exception?.type).toBe("failed_attempt");
    expect(observed.exception?.detail).toMatchObject({ ndr_reason: "customer_unavailable" });
  });

  it("notices a lost parcel and a damaged one", async () => {
    expect(
      (await observe(deps, { tenantId, type: "consignment.lost", aggregateId: "c-1", payload: {} }))
        .exception?.severity,
    ).toBe("high");
    expect(
      (
        await observe(deps, {
          tenantId,
          type: "consignment.damaged",
          aggregateId: "c-2",
          payload: {},
        })
      ).exception?.severity,
    ).toBe("medium");
  });

  it("notices an address nothing could place with any confidence", async () => {
    const observed = await observe(deps, {
      tenantId,
      type: "address.resolved",
      aggregateId: "a-1",
      payload: { confidence: 0.1, source: "none" },
    });

    expect(observed.exception?.type).toBe("address_unclear");
  });

  it("stays quiet about an address it placed confidently", async () => {
    const observed = await observe(deps, {
      tenantId,
      type: "address.resolved",
      aggregateId: "a-2",
      payload: { confidence: 0.9 },
    });

    expect(observed.raised).toBe(false);
  });
});

describe("working the queue", () => {
  it("assigns, resolves, and announces each step", async () => {
    const raised = await observe(deps, closedWithVariance);
    const id = raised.exception?.id ?? "";
    deps.publisher.published.length = 0;

    await work(deps, { tenantId, exceptionId: id, event: { type: "assigned", to: "u1", at } });
    const resolved = await work(deps, {
      tenantId,
      exceptionId: id,
      event: { type: "resolved", by: "u1", note: "recounted at the depot", at },
    });

    expect(resolved.state).toBe("resolved");
    expect(deps.publisher.published.map((p) => p.event.type)).toEqual([
      "exception.assigned",
      "exception.resolved",
    ]);
  });

  it("leaves the queue once resolved", async () => {
    const raised = await observe(deps, closedWithVariance);
    await work(deps, {
      tenantId,
      exceptionId: raised.exception?.id ?? "",
      event: { type: "resolved", by: "u1", note: "done", at },
    });

    expect(await deps.repository.queue(tenantId)).toHaveLength(0);
  });

  it("can be filtered by severity, so the worst is worked first", async () => {
    await observe(deps, closedWithVariance);
    await observe(deps, { tenantId, type: "consignment.damaged", aggregateId: "c-1", payload: {} });

    expect(await deps.repository.queue(tenantId, "high")).toHaveLength(1);
    expect(await deps.repository.queue(tenantId, "medium")).toHaveLength(1);
  });

  it("reports an exception nobody raised", async () => {
    await expect(
      work(deps, { tenantId, exceptionId: "nope", event: { type: "triaged", by: "u", at } }),
    ).rejects.toThrow("no exception with that identifier");
  });

  it("keeps one tenant from working another's exception", async () => {
    const raised = await observe(deps, closedWithVariance);

    await expect(
      work(deps, {
        tenantId: "other",
        exceptionId: raised.exception?.id ?? "",
        event: { type: "triaged", by: "u", at },
      }),
    ).rejects.toThrow("no exception with that identifier");
  });

  it("lets a policy resolve one and records that it was not a person", async () => {
    const raised = await observe(deps, closedWithVariance);

    const resolved = await work(deps, {
      tenantId,
      exceptionId: raised.exception?.id ?? "",
      event: { type: "auto_resolved", by: "policy:cash", note: "within tolerance", at },
    });

    expect(resolved.resolvedAutomatically).toBe(true);
  });
});
