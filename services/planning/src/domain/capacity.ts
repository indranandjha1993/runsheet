export interface Location {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Vehicle {
  readonly id: string;
  readonly maxStops: number;
  readonly maxWeightGrams: number;
  readonly shiftMinutes: number;
}

export interface Job {
  readonly id: string;
  readonly weightGrams: number;
  readonly serviceMinutes: number;
  readonly location: Location;
}

// Rough travel allowance between stops. Real travel time comes from the routing adapter; this
// is only used to decide whether a load could plausibly be served in a shift.
const TRAVEL_MINUTES_PER_STOP = 12;

export function fits(vehicle: Vehicle, jobs: readonly Job[]): boolean {
  if (jobs.length > vehicle.maxStops) return false;

  const weight = jobs.reduce((total, job) => total + job.weightGrams, 0);
  if (weight > vehicle.maxWeightGrams) return false;

  const minutes = jobs.reduce(
    (total, job) => total + job.serviceMinutes + TRAVEL_MINUTES_PER_STOP,
    0,
  );
  return minutes <= vehicle.shiftMinutes;
}

export interface Assignment {
  readonly vehicle: Vehicle;
  readonly jobs: readonly Job[];
}

export interface Packing {
  readonly assigned: readonly Assignment[];
  readonly unassigned: readonly Job[];
}

// Fills each vehicle in turn until nothing more fits, then moves on. Deliberately simple: the
// order that matters is the sequence within a run, which the routing adapter decides.
export function packInto(vehicles: readonly Vehicle[], jobs: readonly Job[]): Packing {
  const remaining = [...jobs];
  const assigned: Assignment[] = [];

  for (const vehicle of vehicles) {
    const taken: Job[] = [];
    for (let i = 0; i < remaining.length; ) {
      const candidate = remaining[i];
      if (candidate !== undefined && fits(vehicle, [...taken, candidate])) {
        taken.push(candidate);
        remaining.splice(i, 1);
      } else {
        i += 1;
      }
    }
    if (taken.length > 0) assigned.push({ vehicle, jobs: taken });
  }

  return { assigned, unassigned: remaining };
}

// Orders stops by how far they are from a point, with the identifier breaking ties so the
// result never depends on the order rows arrived.
export function byDistanceFrom(from: Location): (a: Job, b: Job) => number {
  const squared = (job: Job): number =>
    (job.location.latitude - from.latitude) ** 2 + (job.location.longitude - from.longitude) ** 2;

  return (a, b) => {
    const difference = squared(a) - squared(b);
    return difference !== 0 ? difference : a.id.localeCompare(b.id);
  };
}
