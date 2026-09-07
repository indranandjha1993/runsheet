import { DomainError } from "./errors.js";

const MINUTE = 60_000;

export interface SlaClock {
  readonly startedAt: Date;
  readonly allowanceMinutes: number;
  readonly pausedAt?: Date;
  readonly pausedMinutes: number;
}

export interface StartClockCommand {
  readonly startedAt: Date;
  readonly allowanceMinutes: number;
}

export function startClock(command: StartClockCommand): SlaClock {
  if (command.allowanceMinutes <= 0) {
    throw new DomainError("invalid_input", "an sla allowance must be greater than zero");
  }
  return { ...command, pausedMinutes: 0 };
}

function elapsed(clock: SlaClock, at: Date): number {
  const stoppedAt = clock.pausedAt ?? at;
  return (stoppedAt.getTime() - clock.startedAt.getTime()) / MINUTE - clock.pausedMinutes;
}

export function remaining(clock: SlaClock, at: Date): number {
  return clock.allowanceMinutes - elapsed(clock, at);
}

export function breached(clock: SlaClock, at: Date): boolean {
  return remaining(clock, at) <= 0;
}

// Time spent waiting on someone outside the operation is not our delay. A customer asked to
// reschedule, a shipper who has not confirmed: the clock stops until they answer.
export function pause(clock: SlaClock, at: Date): SlaClock {
  if (clock.pausedAt !== undefined) return clock;
  return { ...clock, pausedAt: at };
}

export function resume(clock: SlaClock, at: Date): SlaClock {
  const pausedAt = clock.pausedAt;
  if (pausedAt === undefined) return clock;

  return {
    startedAt: clock.startedAt,
    allowanceMinutes: clock.allowanceMinutes,
    pausedMinutes: clock.pausedMinutes + (at.getTime() - pausedAt.getTime()) / MINUTE,
  };
}
