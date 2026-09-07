import { useEffect, useRef, useState } from "react";
import {
  acknowledge,
  batchFrom,
  enqueue,
  newQueue,
  runsheetFrom,
  type Queue,
  type Runsheet,
} from "@runsheet/driver";
import type { Api } from "../platform/api.js";

interface RunView { id: string; hubId: string; date: string; workerId?: string; stops: { id: string; sequence: number; actions: { id: string; kind: "deliver" | "pickup" | "return"; consignmentId: string }[] }[] }
interface SyncReply { results: { command_id: string; status: "accepted" | "duplicate" | "rejected"; reason?: string }[] }

const QUEUE_KEY = "runsheet.driver.queue";
const bootId = crypto.randomUUID();
const startedAt = new Date();

function savedQueue(): Partial<Queue> {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "{}") as Partial<Queue>;
  } catch {
    return {};
  }
}

function restoreQueue(workerId: string, runId: string): Queue {
  const saved = savedQueue();
  return newQueue({
    deviceId: localStorage.getItem("runsheet.device") ?? "web-handset",
    bootId,
    workerId,
    runId,
    startedAt,
    ...(saved.lastSequence === undefined ? {} : { lastSequence: saved.lastSequence }),
    ...(saved.pending === undefined ? {} : { pending: saved.pending.map((e) => ({ ...e, at: new Date(e.at) })) }),
  });
}

function toRunsheet(run: RunView): Runsheet {
  return runsheetFrom({
    runId: run.id,
    workerId: run.workerId ?? "driver",
    stops: run.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      name: stop.actions[0]?.consignmentId ?? stop.id,
      address: [],
      actions: stop.actions.map((action) => ({ ...action, barcode: "", proofRequirement: "none" })),
    })),
  });
}

export interface Shift {
  readonly sheet: Runsheet | undefined;
  readonly queue: Queue | undefined;
  readonly note: string | undefined;
  readonly load: (runId: string) => Promise<void>;
  readonly tap: (type: string, stopId: string, extra: Record<string, unknown>) => void;
  readonly sync: (labels: { offline: string; synced: string }) => Promise<void>;
  readonly update: (sheet: Runsheet) => void;
}

// The shift's state: the runsheet being worked and the queue of taps waiting to go. The queue
// is kept in the browser so a closed tab loses nothing.
export function useShift(api: Api, openRun?: string): Shift {
  const [sheet, setSheet] = useState<Runsheet | undefined>();
  const [queue, setQueue] = useState<Queue | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const opened = useRef(false);

  useEffect(() => {
    if (queue !== undefined) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }, [queue]);

  // A run handed over in the link is opened once, the moment the screen is ready.
  useEffect(() => {
    if (openRun === undefined || opened.current) return;
    opened.current = true;
    void load(openRun);
  });

  async function load(runId: string): Promise<void> {
    const result = await api.get<RunView>(`/v1/runs/${encodeURIComponent(runId.trim())}`);
    if (!result.ok) { setNote(result.error.message); return; }
    setSheet(toRunsheet(result.value));
    setQueue(restoreQueue(result.value.workerId ?? "driver", result.value.id));
    setNote(undefined);
  }

  return {
    sheet,
    queue,
    note,
    update: setSheet,
    load,
    tap(type, stopId, extra) {
      if (sheet === undefined || queue === undefined) return;
      const consignment = sheet.stops.find((s) => s.id === stopId)?.actions[0]?.consignmentId ?? "";
      setQueue(enqueue(queue, {
        commandId: crypto.randomUUID(),
        type,
        payload: { stop_id: stopId, consignment_id: consignment, ...extra },
        at: new Date(),
        monotonicMs: Math.round(performance.now()),
        media: [],
      }));
    },
    async sync(labels) {
      if (queue === undefined) return;
      const batch = batchFrom(queue, crypto.randomUUID(), new Date());
      if (batch === undefined) { setNote(labels.synced); return; }
      const result = await api.post<SyncReply>("/v1/sync/batches", batch);
      if (!result.ok) { setNote(labels.offline); return; }
      setQueue(acknowledge(queue, result.value.results.map((r) => ({ commandId: r.command_id, status: r.status, ...(r.reason === undefined ? {} : { reason: r.reason }) }))));
      setNote(labels.synced);
    },
  };
}
