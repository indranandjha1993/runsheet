import { describe, expect, it } from "vitest";
import { eventCatalogue, parseEvent, topicFor } from "./events.js";

const booked = {
  event_id: "01J8Z0T0000000000000000001",
  tenant_id: "01J8Z0T0000000000000000002",
  aggregate_type: "consignment",
  aggregate_id: "01J8Z0T0000000000000000003",
  sequence: 1,
  type: "consignment.booked",
  version: 1,
  occurred_at: "2026-09-07T10:00:00.000Z",
  recorded_at: "2026-09-07T10:00:01.000Z",
  source: "api",
  correlation_id: "01J8Z0T0000000000000000001",
  payload: {
    order_id: "01J8Z0T0000000000000000004",
    service: "next_day",
    payment_mode: "cod",
    cod_amount_minor: 249900,
    cod_currency: "INR",
    guards: { proof_requirement: "photo_and_otp", attempt_limit: 3 },
  },
};

describe("event catalogue", () => {
  it("accepts a well-formed event", () => {
    expect(parseEvent(booked).type).toBe("consignment.booked");
  });

  it("rejects an event type nobody declared", () => {
    expect(() => parseEvent({ ...booked, type: "consignment.teleported" })).toThrow(
      /unknown event type/,
    );
  });

  it("rejects a payload that does not match the declared shape", () => {
    const wrong = { ...booked, payload: { ...booked.payload, cod_amount_minor: "249900" } };

    expect(() => parseEvent(wrong)).toThrow(/cod_amount_minor/);
  });

  it("requires cash on delivery events to carry an amount and a currency", () => {
    const missing = { ...booked, payload: { ...booked.payload, cod_currency: undefined } };

    expect(() => parseEvent(missing)).toThrow(/cod_currency/);
  });

  it("refuses an event recorded before it occurred", () => {
    const backwards = { ...booked, recorded_at: "2026-09-07T09:59:00.000Z" };

    expect(() => parseEvent(backwards)).toThrow(/recorded_at/);
  });

  it("allows confidence only from a source that can be uncertain", () => {
    expect(parseEvent({ ...booked, source: "device", confidence: 0.8 }).confidence).toBe(0.8);
    expect(() => parseEvent({ ...booked, source: "api", confidence: 0.8 })).toThrow(/confidence/);
  });

  it("treats a missing payload as an empty one for events that carry no fields", () => {
    const noPayload = {
      ...booked,
      type: "consignment.picked_up",
      payload: undefined,
    };

    expect(parseEvent(noPayload).payload).toEqual({});
  });

  it("routes every declared event to a topic keyed for ordering", () => {
    expect(topicFor("consignment.booked")).toEqual({ topic: "consignment", key: "aggregate_id" });
    expect(topicFor("stop.completed")).toEqual({ topic: "run", key: "run_id" });
  });

  it("declares a payload shape for every event in the catalogue", () => {
    for (const type of Object.keys(eventCatalogue)) {
      expect(topicFor(type)).toBeDefined();
    }
    expect(Object.keys(eventCatalogue).length).toBeGreaterThan(20);
  });
});
