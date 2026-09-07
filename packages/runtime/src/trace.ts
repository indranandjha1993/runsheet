import { randomBytes } from "node:crypto";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const NO_TRACE = "0".repeat(32);
const NO_SPAN = "0".repeat(16);

export interface TraceContext {
  readonly traceId: string;
  readonly parentId: string;
  readonly sampled: boolean;
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function parseTraceparent(header: string): TraceContext | undefined {
  const value = header.trim();
  if (!TRACEPARENT.test(value)) return undefined;

  // Fixed-width by the format: 00-<32 hex>-<16 hex>-<2 hex>.
  const traceId = value.slice(3, 35);
  const parentId = value.slice(36, 52);
  if (traceId === NO_TRACE || parentId === NO_SPAN) return undefined;

  return { traceId, parentId, sampled: (parseInt(value.slice(53, 55), 16) & 1) === 1 };
}

export function newTraceContext(header: string | undefined): TraceContext {
  const incoming = header === undefined ? undefined : parseTraceparent(header);
  return {
    traceId: incoming?.traceId ?? hex(16),
    parentId: hex(8),
    sampled: incoming?.sampled ?? true,
  };
}

export function toTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.parentId}-${context.sampled ? "01" : "00"}`;
}
