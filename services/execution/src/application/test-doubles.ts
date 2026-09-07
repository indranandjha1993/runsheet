import type { Envelope } from "@runsheet/kernel";
import type { Run } from "../domain/run.js";
import type { Proof } from "../domain/proof.js";
import type { Clock, EventPublisher, ExecutionRepository, Identifiers } from "./ports.js";

export function inMemoryExecution(): ExecutionRepository {
  const runs = new Map<string, { run: Run; version: number }>();
  const proofs = new Map<string, Proof>();
  const sequences = new Map<string, number>();
  const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

  return {
    saveRun: (run, expectedVersion) => {
      runs.set(key(run.tenantId, run.id), { run, version: expectedVersion + 1 });
      return Promise.resolve();
    },
    runById: (tenantId, id) => Promise.resolve(runs.get(key(tenantId, id))),
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
    saveProof: (proof) => {
      proofs.set(key(proof.tenantId, proof.id), proof);
      return Promise.resolve();
    },
    proofById: (tenantId, id) => Promise.resolve(proofs.get(key(tenantId, id))),
    nextSequence: (tenantId, aggregateId) => {
      const at = key(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
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
