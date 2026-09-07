import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "./config.js";

const schema = z.object({
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  BROKER_BROKERS: z.string().default("localhost:19092"),
});

const valid = { PORT: "14210", DATABASE_URL: "postgres://runsheet@localhost:15432/network" };

describe("configuration", () => {
  it("reads and coerces values from the environment", () => {
    const config = loadConfig(schema, valid);

    expect(config.PORT).toBe(14210);
    expect(config.DATABASE_URL).toBe("postgres://runsheet@localhost:15432/network");
  });

  it("applies defaults so a minimal environment still starts", () => {
    const config = loadConfig(schema, valid);

    expect(config.LOG_LEVEL).toBe("info");
    expect(config.BROKER_BROKERS).toBe("localhost:19092");
  });

  it("names every missing variable at once rather than one per restart", () => {
    expect(() => loadConfig(schema, {})).toThrow(
      /DATABASE_URL is required[\s\S]*PORT is required|PORT is required[\s\S]*DATABASE_URL is required/,
    );
  });

  it("explains what a bad value should have been", () => {
    expect(() => loadConfig(schema, { ...valid, PORT: "not-a-port" })).toThrow(/PORT/);
  });

  it("refuses an empty string, which is how a forgotten variable usually arrives", () => {
    expect(() => loadConfig(schema, { ...valid, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("never puts a secret value into the message it throws", () => {
    const withSecret = z.object({ DATABASE_PASSWORD: z.string().min(12) });

    let message = "";
    try {
      loadConfig(withSecret, { DATABASE_PASSWORD: "hunter2" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("hunter2");
  });

  it("lists what it read, with secret values masked, so start-up logs are useful", () => {
    const config = loadConfig(schema, valid);

    expect(loadConfig.describe(schema, config)).toEqual({
      PORT: 14210,
      DATABASE_URL: "[set]",
      LOG_LEVEL: "info",
      BROKER_BROKERS: "localhost:19092",
    });
  });
});
