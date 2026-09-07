import type { z } from "zod";

const SECRET = /password|secret|token|key|url|dsn|credential/i;

export type Environment = Record<string, string | undefined>;

function withoutEmptyStrings(source: Environment): Environment {
  const out: Environment = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") out[key] = value;
  }
  return out;
}

function explain(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.join(".") || "value";
    if (issue.code === "invalid_type" && issue.input === undefined) {
      return `  ${name} is required`;
    }
    return `  ${name} is invalid: ${issue.message}`;
  });
  return `Configuration is not usable:\n${lines.join("\n")}\n\nSee .env.example for every variable and what it means.`;
}

function load<T extends z.ZodType>(schema: T, source: Environment): z.infer<T> {
  const result = schema.safeParse(withoutEmptyStrings(source));
  if (!result.success) {
    throw new Error(explain(result.error));
  }
  return result.data;
}

// Values are read once at start-up. A misconfigured service should fail immediately with every
// problem listed, rather than crash later on the first request that happens to need a variable.
export const loadConfig = Object.assign(load, {
  describe(_schema: z.ZodType, config: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      out[key] = SECRET.test(key) ? "[set]" : value;
    }
    return out;
  },
});
