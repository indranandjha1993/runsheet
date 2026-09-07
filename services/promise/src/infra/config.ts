import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_PROMISE: z.coerce.number().int().positive().default(14250),
  DATABASE_URL_PROMISE: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  SIGNING_SECRET: z.string().min(32),
  TRACKING_LINK_TTL_HOURS: z.coerce.number().int().positive().default(168),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type PromiseConfig = z.infer<typeof schema>;

export function promiseConfig(source: NodeJS.ProcessEnv = process.env): PromiseConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: PromiseConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
