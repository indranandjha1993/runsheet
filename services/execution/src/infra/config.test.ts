import { describe, expect, it } from "vitest";
import { describeConfig, executionConfig } from "./config.js";

const minimal = { DATABASE_URL_EXECUTION: "postgres://runsheet@localhost:15432/execution" };

describe("execution configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(executionConfig(minimal).PORT_EXECUTION).toBe(14230);
  });

  it("refuses to start without a database", () => {
    expect(() => executionConfig({})).toThrow(/DATABASE_URL_EXECUTION is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => executionConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => executionConfig({ ...minimal, PORT_EXECUTION: "http" })).toThrow(/PORT_EXECUTION/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(executionConfig(minimal));

    expect(described["DATABASE_URL_EXECUTION"]).toBe("[set]");
    expect(described["PORT_EXECUTION"]).toBe(14230);
  });
});
