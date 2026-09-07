import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_LINEHAUL: z.coerce.number().int().positive().default(14235),
  DATABASE_URL_LINEHAUL: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type LinehaulConfig = z.infer<typeof schema>;

export function linehaulConfig(source: NodeJS.ProcessEnv = process.env): LinehaulConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: LinehaulConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
