import { z } from "zod";

export const ULID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "must be a ULID");

export const SOURCES = ["api", "device", "connector", "policy", "operator"] as const;
const UNCERTAIN: readonly string[] = ["device", "connector", "policy"];

export const envelopeSchema = z
  .object({
    event_id: ULID,
    tenant_id: ULID,
    aggregate_type: z.string().min(1),
    aggregate_id: ULID,
    sequence: z.number().int().positive(),
    type: z.string().min(1),
    version: z.number().int().positive(),
    occurred_at: z.iso.datetime(),
    recorded_at: z.iso.datetime(),
    source: z.enum(SOURCES),
    correlation_id: ULID,
    causation_id: ULID.optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((e) => Date.parse(e.recorded_at) >= Date.parse(e.occurred_at), {
    message: "recorded_at cannot precede occurred_at",
    path: ["recorded_at"],
  })
  .refine((e) => e.confidence === undefined || UNCERTAIN.includes(e.source), {
    message: "confidence is only meaningful for device, connector, or policy sources",
    path: ["confidence"],
  });

export type Envelope = z.infer<typeof envelopeSchema>;
