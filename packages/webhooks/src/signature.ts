import { createHmac, timingSafeEqual } from "node:crypto";

const MINIMUM_SECRET = 32;
// How far apart the sender's and receiver's clocks may be. Wider than this and an intercepted
// delivery could be replayed later; narrower and honest receivers start rejecting good calls.
const TOLERANCE_SECONDS = 300;

const HEADER = /^t=(\d+),v1=([0-9a-f]{64})$/;

function digest(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret)
    .update(`${String(timestamp)}.${body}`)
    .digest("hex");
}

export function sign(body: string, secrets: readonly string[], at: Date): string {
  const secret = secrets[0];
  if (secret === undefined || secret.length < MINIMUM_SECRET) {
    throw new Error("a webhook secret is too short to be safe");
  }
  const timestamp = Math.floor(at.getTime() / 1000);
  return `t=${String(timestamp)},v1=${digest(body, secret, timestamp)}`;
}

function matches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(presented, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Every secret is tried, so a receiver can rotate without a window where deliveries fail.
export function verify(
  body: string,
  header: string,
  secrets: readonly string[],
  at: Date,
): boolean {
  const value = header.trim();
  if (!HEADER.test(value)) return false;

  // Positions are fixed by the format: t=<digits>,v1=<64 hex>. The signature is the last 64
  // characters and the timestamp is what sits between "t=" and the comma.
  const comma = value.indexOf(",");
  const timestamp = Number(value.slice(2, comma));
  const presented = value.slice(-64);
  if (Math.abs(Math.floor(at.getTime() / 1000) - timestamp) > TOLERANCE_SECONDS) return false;

  return secrets.some((secret) => matches(digest(body, secret, timestamp), presented));
}
