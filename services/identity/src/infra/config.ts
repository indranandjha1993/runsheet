import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_IDENTITY: z.coerce.number().int().positive().default(14200),
  DATABASE_URL_IDENTITY: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type IdentityConfig = z.infer<typeof schema>;

export function identityConfig(source: NodeJS.ProcessEnv = process.env): IdentityConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: IdentityConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
