import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_MONEY: z.coerce.number().int().positive().default(14270),
  DATABASE_URL_MONEY: z.string().min(1),
  IDENTITY_URL: z.string().min(1).default("http://localhost:14200"),
  ORDERS_URL: z.string().min(1).default("http://localhost:14220"),
  // The money service reads consignments with its own credential, not the caller's.
  SERVICE_CREDENTIAL: z.string().min(1),
  // How much a line may differ from the contract before a person looks at it.
  SETTLEMENT_TOLERANCE_MINOR: z.coerce.number().int().nonnegative().default(100),
  SETTLEMENT_TOLERANCE_GRAMS: z.coerce.number().int().nonnegative().default(50),
  // Above this, even a matched line waits for someone to approve it.
  SETTLEMENT_AUTO_APPROVE_BELOW_MINOR: z.coerce.number().int().nonnegative().default(50000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type MoneyConfig = z.infer<typeof schema>;

export function moneyConfig(source: NodeJS.ProcessEnv = process.env): MoneyConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: MoneyConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
