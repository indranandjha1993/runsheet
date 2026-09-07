import { describe, expect, it } from "vitest";
import { newRegistry } from "./registry.js";
import type { Connector } from "./contract.js";

const carrier = (name: string, version = "1.0.0"): Connector => ({
  name,
  version,
  capabilities: ["book", "track"],
  book: () => Promise.resolve({ outcome: "ok", value: { carrierReference: name, labels: [] } }),
  track: () => Promise.resolve({ outcome: "ok", value: { status: "in_transit", events: [] } }),
});

describe("registering connectors", () => {
  it("finds one by name", () => {
    const registry = newRegistry([carrier("swift")]);

    expect(registry.find("swift")?.name).toBe("swift");
  });

  it("finds nothing for a name nobody registered", () => {
    expect(newRegistry([]).find("swift")).toBeUndefined();
  });

  it("refuses two connectors under the same name, because one would shadow the other", () => {
    expect(() => {
      newRegistry([carrier("swift"), carrier("swift", "2.0.0")]);
    }).toThrow("swift is registered twice");
  });

  it("refuses a connector that does not meet the contract", () => {
    const broken = { ...carrier("swift"), version: "latest" };

    expect(() => {
      newRegistry([broken]);
    }).toThrow("version must look like 1.2.3");
  });

  it("lists what is registered, so an operator can see their options", () => {
    const registry = newRegistry([carrier("swift"), carrier("cobalt")]);

    expect(registry.all().map((one) => one.name)).toEqual(["cobalt", "swift"]);
  });
});

describe("choosing a connector for a job", () => {
  const registry = newRegistry([
    carrier("swift"),
    { ...carrier("tracker"), capabilities: ["track"] as const, book: undefined },
  ]);

  it("offers only the ones that can do the job", () => {
    expect(registry.capableOf("book").map((one) => one.name)).toEqual(["swift"]);
  });

  it("offers everyone who can track", () => {
    expect(registry.capableOf("track").map((one) => one.name)).toEqual(["swift", "tracker"]);
  });

  it("offers nobody for something nobody does", () => {
    expect(registry.capableOf("quote")).toEqual([]);
  });
});
