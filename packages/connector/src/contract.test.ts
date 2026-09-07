import { describe, expect, it } from "vitest";
import { assertConnector, describeConnector, supports } from "./contract.js";
import type { Connector } from "./contract.js";

const complete = (): Connector => ({
  name: "reference-carrier",
  version: "1.0.0",
  capabilities: ["quote", "book", "track", "cancel"],
  quote: () => Promise.resolve({ outcome: "ok", value: [] }),
  book: () => Promise.resolve({ outcome: "ok", value: { carrierReference: "X1", labels: [] } }),
  track: () => Promise.resolve({ outcome: "ok", value: { status: "in_transit", events: [] } }),
  cancel: () => Promise.resolve({ outcome: "ok", value: { cancelled: true } }),
});

describe("what a connector must provide", () => {
  it("accepts one that does everything it claims", () => {
    expect(() => {
      assertConnector(complete());
    }).not.toThrow();
  });

  it("refuses one that claims a capability it did not implement", () => {
    const liar = { ...complete(), track: undefined } as unknown as Connector;

    expect(() => {
      assertConnector(liar);
    }).toThrow("reference-carrier claims track but does not implement it");
  });

  it("refuses one with no name, because the registry is keyed by it", () => {
    expect(() => {
      assertConnector({ ...complete(), name: "" });
    }).toThrow("a connector needs a name");
  });

  it("refuses a version that is not a version, because rollback depends on it", () => {
    expect(() => {
      assertConnector({ ...complete(), version: "latest" });
    }).toThrow("version must look like 1.2.3");
  });

  it("refuses one that claims nothing at all", () => {
    expect(() => {
      assertConnector({ ...complete(), capabilities: [] });
    }).toThrow("a connector must do at least one thing");
  });

  it("allows one that does less, as long as it says so", () => {
    const tracker: Connector = {
      name: "tracker-only",
      version: "0.2.0",
      capabilities: ["track"],
      track: () => Promise.resolve({ outcome: "ok", value: { status: "delivered", events: [] } }),
    };

    expect(() => {
      assertConnector(tracker);
    }).not.toThrow();
  });
});

describe("asking what a connector can do", () => {
  it("says yes to what it claims", () => {
    expect(supports(complete(), "book")).toBe(true);
  });

  it("says no to what it does not", () => {
    const tracker: Connector = {
      name: "tracker-only",
      version: "0.2.0",
      capabilities: ["track"],
      track: () => Promise.resolve({ outcome: "ok", value: { status: "delivered", events: [] } }),
    };

    expect(supports(tracker, "book")).toBe(false);
  });

  it("describes itself in a line somebody can read", () => {
    expect(describeConnector(complete())).toBe(
      "reference-carrier 1.0.0 (quote, book, track, cancel)",
    );
  });
});
