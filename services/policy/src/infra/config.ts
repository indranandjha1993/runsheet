import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_POLICY: z.coerce.number().int().positive().default(14280),
  DATABASE_URL_POLICY: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type PolicyConfig = z.infer<typeof schema>;

export function policyConfig(source: NodeJS.ProcessEnv = process.env): PolicyConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: PolicyConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
