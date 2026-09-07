import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_PLANNING: z.coerce.number().int().positive().default(14240),
  DATABASE_URL_PLANNING: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type PlanningConfig = z.infer<typeof schema>;

export function planningConfig(source: NodeJS.ProcessEnv = process.env): PlanningConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: PlanningConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
