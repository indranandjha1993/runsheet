import { createHash, timingSafeEqual } from "node:crypto";
import { DomainError } from "./errors.js";

const PREFIX = "rsk_";
const MINIMUM_SECRET = 32;

export const SCOPES = [
  "consignments:read",
  "consignments:write",
  "runs:read",
  "runs:write",
  "network:read",
  "network:write",
  "addresses:read",
  "addresses:write",
  "pii:read",
] as const;

export type Scope = (typeof SCOPES)[number];

export interface ApiKey {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: readonly Scope[];
  readonly secretHash: string;
  readonly fingerprint: string;
  readonly revokedAt?: Date;
}

export interface IssueKeyCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly secret: string;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// Short, non-reversible, and safe to log. Lets an operator match a line in a log to a key.
export function fingerprintOf(presented: string): string {
  return hashSecret(presented).slice(0, 12);
}

export function issue(command: IssueKeyCommand): { record: ApiKey; presentedSecret: string } {
  if (command.secret.length < MINIMUM_SECRET) {
    throw new DomainError(
      "invalid_input",
      `a key secret must be at least ${String(MINIMUM_SECRET)} characters`,
    );
  }
  if (command.scopes.length === 0) {
    throw new DomainError("invalid_input", "a key needs at least one scope");
  }
  for (const scope of command.scopes) {
    if (!SCOPES.includes(scope as Scope)) {
      throw new DomainError("invalid_input", `unknown scope: ${scope}`);
    }
  }

  const presentedSecret = `${PREFIX}${command.secret}`;
  return {
    presentedSecret,
    record: {
      id: command.id,
      tenantId: command.tenantId,
      name: command.name,
      scopes: command.scopes as readonly Scope[],
      secretHash: hashSecret(presentedSecret),
      fingerprint: fingerprintOf(presentedSecret),
    },
  };
}

export function verify(key: ApiKey, presented: string): boolean {
  if (key.revokedAt !== undefined) return false;
  const expected = Buffer.from(key.secretHash, "hex");
  const actual = Buffer.from(hashSecret(presented), "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// A write scope implies read on the same resource, because nobody wants to grant both.
// Personal data is never implied: it must be granted deliberately.
export function scopesAllow(held: readonly Scope[], needed: Scope): boolean {
  if (held.includes(needed)) return true;
  if (needed === "pii:read") return false;
  const separator = needed.indexOf(":");
  if (needed.slice(separator + 1) !== "read") return false;
  return held.includes(`${needed.slice(0, separator)}:write` as Scope);
}
