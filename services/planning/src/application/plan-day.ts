import { byDistanceFrom, packInto } from "../domain/capacity.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { Job, Location, PlannedRun, PlanningDeps, Vehicle } from "./ports.js";

function nearestFirst(from: Location, jobs: readonly Job[]): readonly Job[] {
  return [...jobs].sort(byDistanceFrom(from));
}

export interface PlanDayCommand {
  readonly tenantId: string;
  readonly hubId: string;
  readonly hubLocation: Location;
  readonly date: string;
  readonly vehicles: readonly Vehicle[];
  readonly jobs: readonly Job[];
}

export interface DayPlan {
  readonly runs: readonly PlannedRun[];
  readonly unassignedJobIds: readonly string[];
}

export async function planDay(deps: PlanningDeps, command: PlanDayCommand): Promise<DayPlan> {
  if (command.jobs.length === 0) {
    throw new DomainError("invalid_input", "there is nothing to plan");
  }

  // When capacity runs short something must be left out, and which one must not depend on the
  // order rows arrived. Nearest work is packed first, so what gets dropped is the far outlier:
  // the most expensive stop to serve and the easiest to defer or give to another vehicle.
  const packed = packInto(command.vehicles, nearestFirst(command.hubLocation, command.jobs));
  const runs: PlannedRun[] = [];

  for (const assignment of packed.assigned) {
    const sequenced = await deps.planner.sequence({
      from: command.hubLocation,
      jobs: assignment.jobs,
    });

    runs.push({
      id: deps.ids.next(),
      tenantId: command.tenantId,
      hubId: command.hubId,
      date: command.date,
      vehicleId: assignment.vehicle.id,
      stops: sequenced.order.map((job, index) => ({ sequence: index + 1, jobId: job.id })),
      estimatedMinutes: sequenced.estimatedMinutes,
    });
  }

  await deps.repository.savePlan(runs, command.tenantId, command.hubId, command.date);

  await announce(deps, {
    tenantId: command.tenantId,
    aggregateType: "plan",
    aggregateId: `${command.hubId}:${command.date}`,
    type: "plan.completed",
    topic: "plan",
    payload: {
      hub_id: command.hubId,
      date: command.date,
      runs: runs.length,
      stops_planned: runs.reduce((total, run) => total + run.stops.length, 0),
      // Nothing is quietly dropped. If a parcel could not be planned, the plan says so.
      unassigned: packed.unassigned.length,
    },
  });

  return { runs, unassignedJobIds: packed.unassigned.map((job) => job.id) };
}
