import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_REPORTING: z.coerce.number().int().positive().default(14290),
  DATABASE_URL_REPORTING: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ReportingConfig = z.infer<typeof schema>;

export function reportingConfig(source: NodeJS.ProcessEnv = process.env): ReportingConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: ReportingConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
