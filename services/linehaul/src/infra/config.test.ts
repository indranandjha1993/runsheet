import { describe, expect, it } from "vitest";
import { describeConfig, linehaulConfig } from "./config.js";

const minimal = { DATABASE_URL_LINEHAUL: "postgres://runsheet@localhost:15432/linehaul" };

describe("linehaul configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(linehaulConfig(minimal).PORT_LINEHAUL).toBe(14235);
  });

  it("refuses to start without a database", () => {
    expect(() => linehaulConfig({})).toThrow(/DATABASE_URL_LINEHAUL is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => linehaulConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => linehaulConfig({ ...minimal, PORT_LINEHAUL: "http" })).toThrow(/PORT_LINEHAUL/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(linehaulConfig(minimal));

    expect(described["DATABASE_URL_LINEHAUL"]).toBe("[set]");
    expect(described["PORT_LINEHAUL"]).toBe(14235);
  });
});
