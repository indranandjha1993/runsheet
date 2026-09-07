import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_ADDRESS: z.coerce.number().int().positive().default(14215),
  DATABASE_URL_ADDRESS: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type AddressConfig = z.infer<typeof schema>;

export function addressConfig(source: NodeJS.ProcessEnv = process.env): AddressConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: AddressConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
