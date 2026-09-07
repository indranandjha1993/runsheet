import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "./errors.js";

const MINIMUM_SECRET = 32;

export interface IssueTokenCommand {
  readonly consignmentId: string;
  readonly tenantId: string;
  readonly secret: string;
  readonly issuedAt: Date;
  readonly validHours: number;
}

export interface TokenContents {
  readonly consignmentId: string;
  readonly tenantId: string;
}

interface Payload {
  readonly c: string;
  readonly t: string;
  readonly e: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

// A consignee has no account and never will. The link itself is the credential: it opens one
// consignment's public view, expires, and carries nothing that identifies anyone.
export function issueToken(command: IssueTokenCommand): string {
  if (command.secret.length < MINIMUM_SECRET) {
    throw new DomainError("invalid_input", "the signing secret is too short to be safe");
  }

  const expiresAt = command.issuedAt.getTime() + command.validHours * 3_600_000;
  const payload: Payload = {
    c: command.consignmentId,
    t: command.tenantId,
    e: Math.floor(expiresAt / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, command.secret)}`;
}

function signatureMatches(encoded: string, presented: string, secret: string): boolean {
  const expected = Buffer.from(sign(encoded, secret));
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function readToken(token: string, secret: string, at: Date): TokenContents | undefined {
  const separator = token.indexOf(".");
  if (separator < 1 || token.slice(separator + 1).includes(".")) return undefined;

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (signature === "" || !signatureMatches(encoded, signature, secret)) return undefined;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as Payload;
    if (payload.e * 1000 < at.getTime()) return undefined;
    return { consignmentId: payload.c, tenantId: payload.t };
  } catch {
    return undefined;
  }
}
