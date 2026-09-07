import { loadConfig } from "@runsheet/runtime";
import { z } from "zod";

const url = (port: number): z.ZodDefault<z.ZodString> =>
  z
    .string()
    .min(1)
    .default(`http://localhost:${String(port)}`);

const schema = z.object({
  PORT_GATEWAY: z.coerce.number().int().positive().default(14000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  IDENTITY_URL: url(14200),
  NETWORK_URL: url(14210),
  ADDRESS_URL: url(14215),
  ORDERS_URL: url(14220),
  EXECUTION_URL: url(14230),
  LINEHAUL_URL: url(14235),
  REPORTING_URL: url(14290),
  PLANNING_URL: url(14240),
  PROMISE_URL: url(14250),
  EXCEPTIONS_URL: url(14260),
  MONEY_URL: url(14270),
  POLICY_URL: url(14280),
});

export type GatewayConfig = z.infer<typeof schema>;

export function gatewayConfig(source: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return loadConfig(schema, source);
}

export function describeConfig(config: GatewayConfig): Record<string, unknown> {
  return loadConfig.describe(schema, config);
}

export function addressOf(config: GatewayConfig, name: string): string | undefined {
  const addresses: Record<string, string> = {
    identity: config.IDENTITY_URL,
    network: config.NETWORK_URL,
    address: config.ADDRESS_URL,
    orders: config.ORDERS_URL,
    execution: config.EXECUTION_URL,
    linehaul: config.LINEHAUL_URL,
    reporting: config.REPORTING_URL,
    planning: config.PLANNING_URL,
    promise: config.PROMISE_URL,
    exceptions: config.EXCEPTIONS_URL,
    money: config.MONEY_URL,
    policy: config.POLICY_URL,
  };
  return addresses[name];
}
