import { describe, expect, it } from "vitest";
import { breached, pause, remaining, resume, startClock } from "./sla.js";

const start = new Date("2026-09-07T10:00:00.000Z");

describe("an sla clock", () => {
  it("counts down from when it started", () => {
    const clock = startClock({ startedAt: start, allowanceMinutes: 60 });

    expect(remaining(clock, new Date("2026-09-07T10:20:00.000Z"))).toBe(40);
  });

  it("reports a breach once the allowance is spent, and not before", () => {
    const clock = startClock({ startedAt: start, allowanceMinutes: 60 });

    expect(breached(clock, new Date("2026-09-07T10:59:00.000Z"))).toBe(false);
    expect(breached(clock, new Date("2026-09-07T11:00:00.000Z"))).toBe(true);
  });

  it("keeps counting past the deadline so the size of the breach is visible", () => {
    const clock = startClock({ startedAt: start, allowanceMinutes: 60 });

    expect(remaining(clock, new Date("2026-09-07T11:30:00.000Z"))).toBe(-30);
  });

  it("stops while paused, because a customer we are waiting on is not our delay", () => {
    let clock = startClock({ startedAt: start, allowanceMinutes: 60 });
    clock = pause(clock, new Date("2026-09-07T10:10:00.000Z"));
    clock = resume(clock, new Date("2026-09-07T10:40:00.000Z"));

    expect(remaining(clock, new Date("2026-09-07T10:50:00.000Z"))).toBe(40);
  });

  it("does not count time while still paused", () => {
    let clock = startClock({ startedAt: start, allowanceMinutes: 60 });
    clock = pause(clock, new Date("2026-09-07T10:10:00.000Z"));

    expect(remaining(clock, new Date("2026-09-07T11:00:00.000Z"))).toBe(50);
    expect(breached(clock, new Date("2026-09-07T12:00:00.000Z"))).toBe(false);
  });

  it("survives several pauses", () => {
    let clock = startClock({ startedAt: start, allowanceMinutes: 120 });
    clock = pause(clock, new Date("2026-09-07T10:10:00.000Z"));
    clock = resume(clock, new Date("2026-09-07T10:30:00.000Z"));
    clock = pause(clock, new Date("2026-09-07T10:40:00.000Z"));
    clock = resume(clock, new Date("2026-09-07T11:10:00.000Z"));

    expect(remaining(clock, new Date("2026-09-07T11:20:00.000Z"))).toBe(90);
  });

  it("ignores a resume when nothing is paused", () => {
    const clock = startClock({ startedAt: start, allowanceMinutes: 60 });

    expect(resume(clock, new Date("2026-09-07T10:10:00.000Z"))).toEqual(clock);
  });

  it("ignores a second pause while already paused", () => {
    const once = pause(
      startClock({ startedAt: start, allowanceMinutes: 60 }),
      new Date("2026-09-07T10:10:00.000Z"),
    );

    expect(pause(once, new Date("2026-09-07T10:20:00.000Z"))).toEqual(once);
  });

  it("refuses an allowance that is not positive", () => {
    expect(() => startClock({ startedAt: start, allowanceMinutes: 0 })).toThrow(
      "an sla allowance must be greater than zero",
    );
  });
});
