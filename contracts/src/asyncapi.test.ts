import { describe, expect, it } from "vitest";
import { eventCatalogue } from "./events.js";
import { asyncApiDocument } from "./asyncapi.js";

describe("the published event specification", () => {
  const document = asyncApiDocument("0.1.0");

  it("names every event the platform emits", () => {
    const published = Object.keys(document.channels);

    expect(published).toHaveLength(Object.keys(eventCatalogue).length);
  });

  it("says which topic each event travels on and how it is keyed", () => {
    const booked = document.channels["consignment.booked"];

    expect(booked).toMatchObject({ topic: "consignment", key: "aggregate_id" });
  });

  it("describes the envelope every event carries, as a schema a client can generate from", () => {
    const properties = Object.keys(
      (document.envelope as { properties: Record<string, unknown> }).properties,
    );

    expect(properties).toEqual(
      expect.arrayContaining(["event_id", "tenant_id", "sequence", "occurred_at", "recorded_at"]),
    );
  });

  it("describes each payload as a schema too, not just a name", () => {
    const booked = document.channels["consignment.booked"];

    expect(booked?.payload).toMatchObject({ type: "object" });
  });

  it("carries the version it was generated for", () => {
    expect(document.info.version).toBe("0.1.0");
  });

  it("can be serialised, because that is the point of publishing it", () => {
    expect(() => JSON.stringify(document)).not.toThrow();
    expect(JSON.stringify(document).length).toBeGreaterThan(1000);
  });

  it("stays in step with the catalogue, so the document cannot drift from the code", () => {
    for (const type of Object.keys(eventCatalogue)) {
      expect(document.channels[type]).toBeDefined();
    }
  });
});
