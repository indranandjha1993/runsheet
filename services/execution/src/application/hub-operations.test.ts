import { beforeEach, describe, expect, it } from "vitest";
import { recordScanIn, recordScanOut } from "./hub-operations.js";
import type { ExecutionDeps } from "./ports.js";
import { countingIds, fixedClock, inMemoryExecution, recordingPublisher } from "./test-doubles.js";

let deps: ExecutionDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(() => {
  deps = {
    repository: inMemoryExecution(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
  };
});

describe("recording a hub inscan", () => {
  it("stores the scan and announces the parcel is in the hub", async () => {
    const scan = await recordScanIn(deps, {
      tenantId: "t",
      hubId: "hub-1",
      workerId: "w1",
      consignmentId: "c-1",
      barcode: "RS0000000013",
      expected: true,
    });

    expect(scan.accepted).toBe(true);
    expect(deps.publisher.published.map((p) => p.event.type)).toEqual(["consignment.scanned_in"]);
    expect(deps.publisher.published[0]?.payload).toMatchObject({
      hub_id: "hub-1",
      consignment_id: "c-1",
    });
  });

  it("carries the weight into the event so billing can act on it", async () => {
    await recordScanIn(deps, {
      tenantId: "t",
      hubId: "hub-1",
      workerId: "w1",
      consignmentId: "c-1",
      barcode: "RS0000000013",
      expected: true,
      weightGrams: 1500,
      dimensionsMm: { length: 300, width: 200, height: 100 },
    });

    expect(deps.publisher.published[0]?.payload).toMatchObject({
      weight_grams: 1500,
      volumetric_grams: 1200,
    });
  });

  it("announces the exception alongside the scan when one was flagged", async () => {
    await recordScanIn(deps, {
      tenantId: "t",
      hubId: "hub-1",
      workerId: "w1",
      consignmentId: "c-1",
      barcode: "RS0000000013",
      expected: false,
    });

    const types = deps.publisher.published.map((p) => p.event.type);
    expect(types).toEqual(["consignment.scanned_in", "consignment.hub_exception"]);
    expect(deps.publisher.published[1]?.payload).toMatchObject({ reason: "unexpected_parcel" });
  });

  it("keeps every scan of the same parcel, because a parcel passes through many hubs", async () => {
    const common = {
      tenantId: "t",
      workerId: "w1",
      consignmentId: "c-1",
      barcode: "RS0000000013",
      expected: true,
    };
    await recordScanIn(deps, { ...common, hubId: "hub-1" });
    await recordScanIn(deps, { ...common, hubId: "hub-2" });

    const history = await deps.repository.scansFor("t", "c-1");
    expect(history.map((s) => s.hubId)).toEqual(["hub-1", "hub-2"]);
  });
});

describe("recording a hub outscan", () => {
  it("announces the parcel left the hub on a run", async () => {
    const scan = await recordScanOut(deps, {
      tenantId: "t",
      hubId: "hub-1",
      workerId: "w1",
      consignmentId: "c-1",
      barcode: "RS0000000013",
      runId: "run-1",
      onRun: true,
    });

    expect(scan.accepted).toBe(true);
    expect(deps.publisher.published.map((p) => p.event.type)).toEqual(["consignment.scanned_out"]);
    expect(deps.publisher.published[0]?.payload).toMatchObject({ run_id: "run-1" });
  });

  it("raises an exception and announces no departure when the parcel is not on the run", async () => {
    const scan = await recordScanOut(deps, {
      tenantId: "t",
      hubId: "hub-1",
      workerId: "w1",
      consignmentId: "c-1",
      barcode: "RS0000000013",
      runId: "run-1",
      onRun: false,
    });

    expect(scan.accepted).toBe(false);
    expect(deps.publisher.published.map((p) => p.event.type)).toEqual([
      "consignment.hub_exception",
    ]);
  });
});
