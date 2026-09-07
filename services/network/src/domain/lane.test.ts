import { describe, expect, it } from "vitest";
import { arrivalFor, lane, type Lane } from "./lane.js";

const overnight: Lane = lane({
  id: "ln-blr-hyd",
  originHubId: "hub-blr",
  destinationHubId: "hub-hyd",
  service: "next_day",
  transitHours: 14,
  cutoffMinutesOfDay: 18 * 60,
  operatingDays: [1, 2, 3, 4, 5, 6],
});

describe("lane", () => {
  it("rejects a lane that begins and ends at the same hub", () => {
    expect(() => lane({ ...overnight, destinationHubId: "hub-blr" })).toThrow(
      "a lane must connect two different hubs",
    );
  });

  it("rejects a transit time that is zero or negative", () => {
    expect(() => lane({ ...overnight, transitHours: 0 })).toThrow(
      "transit time must be greater than zero",
    );
  });

  it("rejects a cutoff outside the day", () => {
    expect(() => lane({ ...overnight, cutoffMinutesOfDay: 1441 })).toThrow(
      "cutoff must fall within the day",
    );
  });

  it("rejects a lane that never operates", () => {
    expect(() => lane({ ...overnight, operatingDays: [] })).toThrow(
      "a lane must operate on at least one day",
    );
  });

  it("departs at the cutoff and adds transit time when booked before it", () => {
    const bookedMondayMorning = new Date("2026-09-07T10:00:00.000Z");

    // Departs Monday 18:00, fourteen hours in transit, arrives Tuesday 08:00.
    expect(arrivalFor(overnight, bookedMondayMorning)).toEqual(
      new Date("2026-09-08T08:00:00.000Z"),
    );
  });

  it("waits for the next departure when booked after the cutoff", () => {
    const bookedMondayEvening = new Date("2026-09-07T19:00:00.000Z");

    // Missed Monday's departure, so Tuesday 18:00 plus fourteen hours.
    expect(arrivalFor(overnight, bookedMondayEvening)).toEqual(
      new Date("2026-09-09T08:00:00.000Z"),
    );
  });

  it("treats the cutoff minute itself as still in time", () => {
    const booked = new Date("2026-09-07T18:00:00.000Z");

    expect(arrivalFor(overnight, booked)).toEqual(new Date("2026-09-08T08:00:00.000Z"));
  });

  it("skips days the lane does not operate", () => {
    const weekdaysOnly = lane({ ...overnight, operatingDays: [1, 2, 3, 4, 5] });
    const bookedFridayEvening = new Date("2026-09-11T19:00:00.000Z");

    // Saturday and Sunday are skipped, so Monday 18:00 plus fourteen hours.
    expect(arrivalFor(weekdaysOnly, bookedFridayEvening)).toEqual(
      new Date("2026-09-15T08:00:00.000Z"),
    );
  });

  it("refuses to search beyond a fortnight rather than looping forever", () => {
    const never = lane({ ...overnight, operatingDays: [0] });
    const impossible = { ...never, operatingDays: [] as unknown as number[] };

    expect(() => arrivalFor(impossible, new Date("2026-09-07T10:00:00.000Z"))).toThrow(
      "no operating day found within a fortnight",
    );
  });
});
