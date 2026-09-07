import { scanIn, scanOut, type Dimensions, type Scan } from "../domain/hub-floor.js";
import { announce } from "./announce.js";
import type { ExecutionDeps } from "./ports.js";

export interface ScanInCommand {
  readonly tenantId: string;
  readonly hubId: string;
  readonly workerId: string;
  readonly consignmentId: string;
  readonly barcode: string;
  readonly expected: boolean;
  readonly weightGrams?: number;
  readonly bookedWeightGrams?: number;
  readonly dimensionsMm?: Dimensions;
}

function measurement(scan: Scan): Record<string, unknown> {
  return {
    ...(scan.weightGrams === undefined ? {} : { weight_grams: scan.weightGrams }),
    ...(scan.volumetricGrams === undefined ? {} : { volumetric_grams: scan.volumetricGrams }),
  };
}

async function announceException(deps: ExecutionDeps, scan: Scan, reason: string): Promise<void> {
  await announce(deps, {
    tenantId: scan.tenantId,
    aggregateType: "consignment",
    aggregateId: scan.consignmentId,
    type: "consignment.hub_exception",
    topic: "consignment",
    payload: { hub_id: scan.hubId, consignment_id: scan.consignmentId, reason },
  });
}

export async function recordScanIn(deps: ExecutionDeps, command: ScanInCommand): Promise<Scan> {
  const scan = scanIn(
    {
      tenantId: command.tenantId,
      hubId: command.hubId,
      workerId: command.workerId,
      at: deps.clock.now(),
    },
    {
      consignmentId: command.consignmentId,
      expected: command.expected,
      barcode: command.barcode,
      ...(command.weightGrams === undefined ? {} : { weightGrams: command.weightGrams }),
      ...(command.bookedWeightGrams === undefined
        ? {}
        : { bookedWeightGrams: command.bookedWeightGrams }),
      ...(command.dimensionsMm === undefined ? {} : { dimensionsMm: command.dimensionsMm }),
    },
  );

  await deps.repository.saveScan(deps.ids.next(), scan, "in");
  await announce(deps, {
    tenantId: scan.tenantId,
    aggregateType: "consignment",
    aggregateId: scan.consignmentId,
    type: "consignment.scanned_in",
    topic: "consignment",
    payload: {
      hub_id: scan.hubId,
      consignment_id: scan.consignmentId,
      worker_id: scan.workerId,
      ...measurement(scan),
    },
  });

  if (scan.exception !== undefined) await announceException(deps, scan, scan.exception);
  return scan;
}

export interface ScanOutCommand {
  readonly tenantId: string;
  readonly hubId: string;
  readonly workerId: string;
  readonly consignmentId: string;
  readonly barcode: string;
  readonly runId: string;
  readonly onRun: boolean;
}

export async function recordScanOut(deps: ExecutionDeps, command: ScanOutCommand): Promise<Scan> {
  const scan = scanOut(
    {
      tenantId: command.tenantId,
      hubId: command.hubId,
      workerId: command.workerId,
      at: deps.clock.now(),
    },
    {
      consignmentId: command.consignmentId,
      runId: command.runId,
      onRun: command.onRun,
      barcode: command.barcode,
    },
  );

  await deps.repository.saveScan(deps.ids.next(), scan, "out", command.runId);

  // A refused outscan is not a departure. Announcing one would tell the customer the parcel is
  // on its way while it is still standing on the hub floor.
  if (!scan.accepted) {
    await announceException(deps, scan, scan.exception ?? "not_on_this_run");
    return scan;
  }

  await announce(deps, {
    tenantId: scan.tenantId,
    aggregateType: "consignment",
    aggregateId: scan.consignmentId,
    type: "consignment.scanned_out",
    topic: "consignment",
    payload: {
      hub_id: scan.hubId,
      consignment_id: scan.consignmentId,
      worker_id: scan.workerId,
      run_id: command.runId,
    },
  });
  return scan;
}
