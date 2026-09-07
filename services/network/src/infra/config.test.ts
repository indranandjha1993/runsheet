import { describe, expect, it } from "vitest";
import { describeConfig, networkConfig } from "./config.js";

const minimal = { DATABASE_URL_NETWORK: "postgres://runsheet@localhost:15432/network" };

describe("network configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(networkConfig(minimal).PORT_NETWORK).toBe(14210);
  });

  it("refuses to start without a database", () => {
    expect(() => networkConfig({})).toThrow(/DATABASE_URL_NETWORK is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => networkConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => networkConfig({ ...minimal, PORT_NETWORK: "http" })).toThrow(/PORT_NETWORK/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(networkConfig(minimal));

    expect(described["DATABASE_URL_NETWORK"]).toBe("[set]");
    expect(described["PORT_NETWORK"]).toBe(14210);
  });
});
