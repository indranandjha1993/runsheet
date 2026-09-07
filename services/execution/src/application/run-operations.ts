import { applyToRun, cashSummary, plannedRun, type Run, type RunEvent } from "../domain/run.js";
import { plannedStop, type ActionKind } from "../domain/stop.js";
import { capture, type ProofKind } from "../domain/proof.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { ExecutionDeps } from "./ports.js";

export interface PlanRunCommand {
  readonly tenantId: string;
  readonly hubId: string;
  readonly date: string;
  readonly stops: readonly {
    readonly sequence: number;
    readonly actions: readonly { readonly kind: ActionKind; readonly consignmentId: string }[];
  }[];
}

export async function planRun(deps: ExecutionDeps, command: PlanRunCommand): Promise<Run> {
  const run = plannedRun({
    id: deps.ids.next(),
    tenantId: command.tenantId,
    hubId: command.hubId,
    date: command.date,
    stops: command.stops.map((stop) =>
      plannedStop({
        id: deps.ids.next(),
        sequence: stop.sequence,
        actions: stop.actions.map((action) => ({ id: deps.ids.next(), ...action })),
      }),
    ),
  });

  await deps.repository.saveRun(run, 0);
  await announce(deps, {
    tenantId: run.tenantId,
    aggregateType: "run",
    aggregateId: run.id,
    type: "run.planned",
    topic: "run",
    payload: { hub_id: run.hubId, date: run.date, stop_count: run.stops.length },
  });
  return run;
}

export interface RecordRunEventCommand {
  readonly tenantId: string;
  readonly runId: string;
  readonly event: RunEvent;
}

function payloadFor(run: Run, event: RunEvent): Record<string, unknown> {
  if (event.type === "closed" || event.type === "force_closed") {
    return { status: run.status, cash: cashSummary(run), forced_close: run.forcedClose };
  }
  if (event.type === "action_recorded") {
    return { status: run.status, stop_id: event.stopId, action_id: event.action.actionId };
  }
  return { status: run.status };
}

export async function recordRunEvent(
  deps: ExecutionDeps,
  command: RecordRunEventCommand,
): Promise<Run> {
  const found = await deps.repository.runById(command.tenantId, command.runId);
  if (found === undefined) throw new DomainError("not_found", "no run with that identifier");

  const next = applyToRun(found.run, command.event);
  await deps.repository.saveRun(next, found.version);

  await announce(deps, {
    tenantId: next.tenantId,
    aggregateType: "run",
    aggregateId: next.id,
    type: `run.${command.event.type}`,
    topic: "run",
    payload: payloadFor(next, command.event),
  });
  return next;
}

export interface CaptureProofCommand {
  readonly tenantId: string;
  readonly consignmentId: string;
  readonly requirement: string;
  readonly kinds: readonly ProofKind[];
  readonly mediaIds: readonly string[];
  readonly geofenceOk?: boolean;
}

export async function captureProof(
  deps: ExecutionDeps,
  command: CaptureProofCommand,
): Promise<{ id: string; satisfiesRequirement: boolean }> {
  const proof = capture({
    id: deps.ids.next(),
    tenantId: command.tenantId,
    consignmentId: command.consignmentId,
    requirement: command.requirement,
    kinds: command.kinds,
    capturedAt: deps.clock.now(),
    mediaIds: command.mediaIds,
    ...(command.geofenceOk === undefined ? {} : { geofenceOk: command.geofenceOk }),
  });

  await deps.repository.saveProof(proof);
  await announce(deps, {
    tenantId: proof.tenantId,
    aggregateType: "proof",
    aggregateId: proof.id,
    type: "proof.captured",
    topic: "run",
    payload: {
      consignment_id: proof.consignmentId,
      kinds: proof.kinds,
      satisfies_requirement: proof.satisfiesRequirement,
      media_ids: proof.mediaIds,
    },
  });

  return { id: proof.id, satisfiesRequirement: proof.satisfiesRequirement };
}
