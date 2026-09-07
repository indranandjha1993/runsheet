import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_EXCEPTIONS: z.coerce.number().int().positive().default(14260),
  DATABASE_URL_EXCEPTIONS: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ExceptionsConfig = z.infer<typeof schema>;

export function exceptionsConfig(source: NodeJS.ProcessEnv = process.env): ExceptionsConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: ExceptionsConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
