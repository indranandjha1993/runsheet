const MINUTES_IN_DAY = 24 * 60;
const SEARCH_LIMIT_DAYS = 14;

export interface Lane {
  readonly id: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
  readonly service: string;
  readonly transitHours: number;
  /** Minutes since midnight, in the origin hub's own day. */
  readonly cutoffMinutesOfDay: number;
  /** Days of the week the lane departs, Sunday is 0. */
  readonly operatingDays: readonly number[];
}

export function lane(candidate: Lane): Lane {
  if (candidate.originHubId === candidate.destinationHubId) {
    throw new Error("a lane must connect two different hubs");
  }
  if (candidate.transitHours <= 0) {
    throw new Error("transit time must be greater than zero");
  }
  if (candidate.cutoffMinutesOfDay < 0 || candidate.cutoffMinutesOfDay > MINUTES_IN_DAY) {
    throw new Error("cutoff must fall within the day");
  }
  if (candidate.operatingDays.length === 0) {
    throw new Error("a lane must operate on at least one day");
  }
  return candidate;
}

function minutesOfDay(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

function atCutoff(day: Date, cutoffMinutesOfDay: number): Date {
  const departure = new Date(day);
  departure.setUTCHours(0, cutoffMinutesOfDay, 0, 0);
  return departure;
}

function nextDeparture(target: Lane, bookedAt: Date): Date {
  const missedToday = minutesOfDay(bookedAt) > target.cutoffMinutesOfDay;
  const candidate = new Date(bookedAt);
  if (missedToday) candidate.setUTCDate(candidate.getUTCDate() + 1);

  for (let offset = 0; offset <= SEARCH_LIMIT_DAYS; offset += 1) {
    const day = new Date(candidate);
    day.setUTCDate(day.getUTCDate() + offset);
    if (target.operatingDays.includes(day.getUTCDay())) {
      return atCutoff(day, target.cutoffMinutesOfDay);
    }
  }
  throw new Error("no operating day found within a fortnight");
}

export function arrivalFor(target: Lane, bookedAt: Date): Date {
  const departure = nextDeparture(target, bookedAt);
  return new Date(departure.getTime() + target.transitHours * 60 * 60 * 1000);
}
