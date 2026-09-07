import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const schema = z.object({
  PORT_ORDERS: z.coerce.number().int().positive().default(14220),
  DATABASE_URL_ORDERS: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type OrdersConfig = z.infer<typeof schema>;

export function ordersConfig(source: NodeJS.ProcessEnv = process.env): OrdersConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: OrdersConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}
