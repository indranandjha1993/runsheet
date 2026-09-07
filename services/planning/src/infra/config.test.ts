import { describe, expect, it } from "vitest";
import { describeConfig, planningConfig } from "./config.js";

const minimal = { DATABASE_URL_PLANNING: "postgres://runsheet@localhost:15432/planning" };

describe("planning configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(planningConfig(minimal).PORT_PLANNING).toBe(14240);
  });

  it("refuses to start without a database", () => {
    expect(() => planningConfig({})).toThrow(/DATABASE_URL_PLANNING is required/);
  });


  it("points the reader at the example file when something is missing", () => {
    expect(() => planningConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => planningConfig({ ...minimal, PORT_PLANNING: "http" })).toThrow(/PORT_PLANNING/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(planningConfig(minimal));

    expect(described["DATABASE_URL_PLANNING"]).toBe("[set]");
    expect(described["PORT_PLANNING"]).toBe(14240);
  });
});
