import type { Job, Location } from "../domain/capacity.js";
import type { RoutePlanner, SequenceRequest, SequenceResult } from "../application/ports.js";

// Rough metres per degree at the latitudes we operate in. Good enough to order stops; a real
// routing provider replaces this through the same port when one is configured.
const METRES_PER_DEGREE = 111_000;
const METRES_PER_MINUTE = 400;

function distance(a: Location, b: Location): number {
  const latitude = (a.latitude - b.latitude) * METRES_PER_DEGREE;
  const longitude =
    (a.longitude - b.longitude) * METRES_PER_DEGREE * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(latitude, longitude);
}

function closest(from: Location, jobs: readonly Job[]): Job | undefined {
  let best: Job | undefined;
  let bestDistance = Infinity;

  for (const job of jobs) {
    const candidate = distance(from, job.location);
    // A tie falls back to the identifier so the plan never depends on the order rows arrived.
    if (
      candidate < bestDistance ||
      (candidate === bestDistance && best !== undefined && job.id < best.id)
    ) {
      best = job;
      bestDistance = candidate;
    }
  }
  return best;
}

// The built-in sequencer, used when no routing provider is configured, so a fresh clone plans a
// day without an account anywhere. It is deliberately simple; the port is where a real provider
// goes.
export function nearestFirstPlanner(): RoutePlanner {
  return {
    sequence(request: SequenceRequest): Promise<SequenceResult> {
      const remaining = [...request.jobs];
      const order: Job[] = [];
      let position = request.from;
      let metres = 0;
      let serviceMinutes = 0;

      while (remaining.length > 0) {
        const next = closest(position, remaining);
        if (next === undefined) break;

        metres += distance(position, next.location);
        serviceMinutes += next.serviceMinutes;
        order.push(next);
        position = next.location;
        remaining.splice(remaining.indexOf(next), 1);
      }

      return Promise.resolve({
        order,
        estimatedMinutes: Math.round(metres / METRES_PER_MINUTE + serviceMinutes),
      });
    },
  };
}
