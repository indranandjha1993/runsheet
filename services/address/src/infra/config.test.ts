import { describe, expect, it } from "vitest";
import { describeConfig, addressConfig } from "./config.js";

const minimal = { DATABASE_URL_ADDRESS: "postgres://runsheet@localhost:15432/address" };

describe("address configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(addressConfig(minimal).PORT_ADDRESS).toBe(14215);
  });

  it("refuses to start without a database", () => {
    expect(() => addressConfig({})).toThrow(/DATABASE_URL_ADDRESS is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => addressConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => addressConfig({ ...minimal, PORT_ADDRESS: "http" })).toThrow(/PORT_ADDRESS/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(addressConfig(minimal));

    expect(described["DATABASE_URL_ADDRESS"]).toBe("[set]");
    expect(described["PORT_ADDRESS"]).toBe(14215);
  });
});
