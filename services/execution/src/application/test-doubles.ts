import type { Envelope } from "@runsheet/kernel";
import type { Run } from "../domain/run.js";
import type { Proof } from "../domain/proof.js";
import type { Scan } from "../domain/hub-floor.js";
import type { Clock, EventPublisher, ExecutionRepository, Identifiers } from "./ports.js";

const keyOf = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

function runStore(): Pick<ExecutionRepository, "saveRun" | "runById" | "openRuns"> {
  const runs = new Map<string, { run: Run; version: number }>();
  return {
    saveRun: (run, expectedVersion) => {
      runs.set(keyOf(run.tenantId, run.id), { run, version: expectedVersion + 1 });
      return Promise.resolve();
    },
    runById: (tenantId, id) => Promise.resolve(runs.get(keyOf(tenantId, id))),
    openRuns: (tenantId, hubId, date) =>
      Promise.resolve(
        [...runs.values()]
          .map((entry) => entry.run)
          .filter(
            (run) =>
              run.tenantId === tenantId &&
              run.hubId === hubId &&
              run.date === date &&
              run.status !== "closed" &&
              run.status !== "cancelled",
          ),
      ),
  };
}

function proofStore(): Pick<ExecutionRepository, "saveProof" | "proofById"> {
  const proofs = new Map<string, Proof>();
  return {
    saveProof: (proof) => {
      proofs.set(keyOf(proof.tenantId, proof.id), proof);
      return Promise.resolve();
    },
    proofById: (tenantId, id) => Promise.resolve(proofs.get(keyOf(tenantId, id))),
  };
}

function scanStore(): Pick<ExecutionRepository, "saveScan" | "scansFor"> {
  const scans: { key: string; scan: Scan }[] = [];
  return {
    saveScan: (_id, scan) => {
      scans.push({ key: keyOf(scan.tenantId, scan.consignmentId), scan });
      return Promise.resolve();
    },
    scansFor: (tenantId, consignmentId) =>
      Promise.resolve(
        scans.filter((e) => e.key === keyOf(tenantId, consignmentId)).map((e) => e.scan),
      ),
  };
}

function streamStore(): Pick<ExecutionRepository, "nextSequence" | "claimCommand"> {
  const sequences = new Map<string, number>();
  const claimed = new Map<string, string>();
  let issued = 0;
  return {
    claimCommand: (tenantId, deviceId, commandId) => {
      const at = keyOf(tenantId, `${deviceId}:${commandId}`);
      if (claimed.has(at)) return Promise.resolve(undefined);
      issued += 1;
      const eventId = `01J8Z0T00000000000000${String(issued).padStart(5, "0")}`;
      claimed.set(at, eventId);
      return Promise.resolve(eventId);
    },
    nextSequence: (tenantId, aggregateId) => {
      const at = keyOf(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
}

export function inMemoryExecution(): ExecutionRepository {
  return { ...runStore(), ...proofStore(), ...scanStore(), ...streamStore() };
}

export interface Published {
  event: Envelope;
  payload: Record<string, unknown>;
  topic: string;
}

export function recordingPublisher(): EventPublisher & { published: Published[] } {
  const published: Published[] = [];
  return {
    published,
    publish: (event, payload, topic) => {
      published.push({ event, payload, topic });
      return Promise.resolve();
    },
  };
}

export function fixedClock(at: string): Clock {
  return { now: () => new Date(at) };
}

export function countingIds(): Identifiers {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `01J8Z0T00000000000000${String(n).padStart(5, "0")}`;
    },
  };
}
