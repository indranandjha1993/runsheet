import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_EXECUTION: z.coerce.number().int().positive().default(14230),
  DATABASE_URL_EXECUTION: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ExecutionConfig = z.infer<typeof schema>;

export function executionConfig(source: NodeJS.ProcessEnv = process.env): ExecutionConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: ExecutionConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
