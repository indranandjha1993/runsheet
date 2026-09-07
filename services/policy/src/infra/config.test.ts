import { describe, expect, it } from "vitest";
import { describeConfig, policyConfig } from "./config.js";

const minimal = { DATABASE_URL_POLICY: "postgres://runsheet@localhost:15432/policy" };

describe("policy configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(policyConfig(minimal).PORT_POLICY).toBe(14280);
  });

  it("refuses to start without a database", () => {
    expect(() => policyConfig({})).toThrow(/DATABASE_URL_POLICY is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => policyConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => policyConfig({ ...minimal, PORT_POLICY: "http" })).toThrow(/PORT_POLICY/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(policyConfig(minimal));

    expect(described["DATABASE_URL_POLICY"]).toBe("[set]");
    expect(described["PORT_POLICY"]).toBe(14280);
  });
});
