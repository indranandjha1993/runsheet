import { describe, expect, it } from "vitest";
import { describeConfig, reportingConfig } from "./config.js";

const minimal = { DATABASE_URL_REPORTING: "postgres://runsheet@localhost:15432/reporting" };

describe("reporting configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(reportingConfig(minimal).PORT_REPORTING).toBe(14290);
  });

  it("refuses to start without a database", () => {
    expect(() => reportingConfig({})).toThrow(/DATABASE_URL_REPORTING is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => reportingConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => reportingConfig({ ...minimal, PORT_REPORTING: "http" })).toThrow(/PORT_REPORTING/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(reportingConfig(minimal));

    expect(described["DATABASE_URL_REPORTING"]).toBe("[set]");
    expect(described["PORT_REPORTING"]).toBe(14290);
  });
});
