import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_NETWORK: z.coerce.number().int().positive().default(14210),
  DATABASE_URL_NETWORK: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type NetworkConfig = z.infer<typeof schema>;

export function networkConfig(source: NodeJS.ProcessEnv = process.env): NetworkConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: NetworkConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
