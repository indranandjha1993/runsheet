import { describe, expect, it } from "vitest";
import { envelope, type EventSource } from "./event.js";

const base = {
  tenantId: "01J8Z0T0000000000000000001",
  aggregateType: "consignment",
  aggregateId: "01J8Z0T0000000000000000002",
  sequence: 1,
  type: "consignment.booked",
  version: 1,
  occurredAt: new Date("2026-09-07T10:00:00.000Z"),
  source: "api" as EventSource,
};

describe("event envelope", () => {
  it("stamps an identifier and the time the server recorded it", () => {
    const recordedAt = new Date("2026-09-07T10:00:02.000Z");
    const event = envelope({ ...base, recordedAt });

    expect(event.eventId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(event.recordedAt).toEqual(recordedAt);
    expect(event.occurredAt).toEqual(base.occurredAt);
  });

  it("carries correlation forward and sets causation from the triggering event", () => {
    const cause = envelope({ ...base, recordedAt: base.occurredAt });
    const effect = envelope({
      ...base,
      sequence: 2,
      type: "consignment.picked_up",
      recordedAt: base.occurredAt,
      causedBy: cause,
    });

    expect(effect.causationId).toBe(cause.eventId);
    expect(effect.correlationId).toBe(cause.correlationId);
  });

  it("starts a new correlation when nothing caused it", () => {
    const event = envelope({ ...base, recordedAt: base.occurredAt });

    expect(event.correlationId).toBe(event.eventId);
    expect(event.causationId).toBeUndefined();
  });

  it("rejects a sequence that is not a positive integer", () => {
    expect(() => envelope({ ...base, sequence: 0, recordedAt: base.occurredAt })).toThrow(
      "sequence must be a positive integer",
    );
  });

  it("rejects an event recorded before it occurred", () => {
    expect(() => envelope({ ...base, recordedAt: new Date("2026-09-07T09:59:59.000Z") })).toThrow(
      "recordedAt cannot precede occurredAt",
    );
  });

  it("keeps confidence only for sources that are probabilistic", () => {
    const fromDevice = envelope({
      ...base,
      source: "device",
      confidence: 0.82,
      recordedAt: base.occurredAt,
    });
    expect(fromDevice.confidence).toBe(0.82);

    expect(() =>
      envelope({ ...base, source: "api", confidence: 0.5, recordedAt: base.occurredAt }),
    ).toThrow("confidence is only meaningful for device, connector, or policy sources");
  });

  it("rejects a confidence outside zero and one", () => {
    expect(() =>
      envelope({ ...base, source: "connector", confidence: 1.4, recordedAt: base.occurredAt }),
    ).toThrow("confidence must be between 0 and 1");
  });
});

describe("identifiers", () => {
  it("sorts identifiers in the order the events were recorded", () => {
    const earlier = envelope({ ...base, recordedAt: new Date("2026-09-07T10:00:00.000Z") });
    const later = envelope({
      ...base,
      sequence: 2,
      recordedAt: new Date("2026-09-07T11:00:00.000Z"),
    });

    expect(earlier.eventId < later.eventId).toBe(true);
  });
});
