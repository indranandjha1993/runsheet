import { describe, expect, it } from "vitest";
import { describeConfig, exceptionsConfig } from "./config.js";

const minimal = { DATABASE_URL_EXCEPTIONS: "postgres://runsheet@localhost:15432/exceptions" };

describe("exceptions configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(exceptionsConfig(minimal).PORT_EXCEPTIONS).toBe(14260);
  });

  it("refuses to start without a database", () => {
    expect(() => exceptionsConfig({})).toThrow(/DATABASE_URL_EXCEPTIONS is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => exceptionsConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => exceptionsConfig({ ...minimal, PORT_EXCEPTIONS: "http" })).toThrow(/PORT_EXCEPTIONS/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(exceptionsConfig(minimal));

    expect(described["DATABASE_URL_EXCEPTIONS"]).toBe("[set]");
    expect(described["PORT_EXCEPTIONS"]).toBe(14260);
  });
});
