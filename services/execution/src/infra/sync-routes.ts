import { z } from "zod";
import { callerFrom, requireScope } from "@runsheet/auth";
import type { Route } from "../adapters/http.js";
import { syncBatch, type SyncBatchCommand, type SyncBatchResult } from "../application/sync.js";
import type { RouteDeps } from "./routes.js";

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

export const syncBody = z.object({
  device_id: z.string().min(1),
  device_boot_id: z.string().min(1),
  worker_id: z.string().min(1),
  run_id: z.string().min(1),
  batch_id: z.string().min(1),
  clock: z.object({
    device_sent_at: z.iso.datetime(),
    device_monotonic_ms: z.number().int().nonnegative(),
  }),
  entries: z
    .array(
      z.object({
        command_id: z.string().min(1),
        device_sequence: z.number().int().nonnegative(),
        type: z.string().min(1),
        payload: z.record(z.string(), z.unknown()),
        occurred_at_device: z.iso.datetime(),
        monotonic_ms: z.number().int().nonnegative(),
        media: z
          .array(
            z.object({
              media_id: z.string().min(1),
              sha256: z.string(),
              bytes: z.number().int().positive(),
              kind: z.string().min(1),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});

type SyncBody = z.infer<typeof syncBody>;

function batchFrom(tenantId: string, body: SyncBody): SyncBatchCommand {
  return {
    tenantId,
    deviceId: body.device_id,
    deviceBootId: body.device_boot_id,
    workerId: body.worker_id,
    runId: body.run_id,
    batchId: body.batch_id,
    clock: {
      deviceSentAt: new Date(body.clock.device_sent_at),
      monotonicNowMs: body.clock.device_monotonic_ms,
    },
    entries: body.entries.map((entry) => ({
      commandId: entry.command_id,
      deviceSequence: entry.device_sequence,
      type: entry.type,
      payload: entry.payload,
      occurredAtDevice: new Date(entry.occurred_at_device),
      monotonicMs: entry.monotonic_ms,
      media: entry.media.map((media) => ({
        mediaId: media.media_id,
        sha256: media.sha256,
        bytes: media.bytes,
        kind: media.kind,
      })),
    })),
  };
}

function syncResponse(result: SyncBatchResult, receivedAt: Date): Record<string, unknown> {
  return {
    batch_id: result.batchId,
    server_received_at: receivedAt,
    results: result.results.map((one) => ({
      command_id: one.commandId,
      status: one.status,
      ...(one.eventId === undefined ? {} : { event_id: one.eventId }),
      ...(one.reason === undefined ? {} : { reason: one.reason }),
    })),
    uploads: result.uploads.map((upload) => ({
      media_id: upload.mediaId,
      sha256: upload.sha256,
    })),
  };
}

export function syncRoutes(deps: RouteDeps): Route[] {
  return [
    {
      method: "POST",
      path: "/v1/sync/batches",
      handle: async (request) => {
        const caller = await callerFrom(deps.lookup, request.headers);
        requireScope(caller, "runs:write");

        const parsed = syncBody.safeParse(request.body);
        if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

        const result = await syncBatch(deps, batchFrom(caller.tenantId, parsed.data));
        return { status: 200, body: syncResponse(result, deps.clock.now()) };
      },
    },
  ];
}
