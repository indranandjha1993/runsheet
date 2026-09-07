import { envelope } from "@runsheet/kernel";
import type { PlanningDeps } from "./ports.js";

export async function announce(
  deps: PlanningDeps,
  what: {
    readonly tenantId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly type: string;
    readonly topic: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<void> {
  const at = deps.clock.now();
  const event = envelope({
    tenantId: what.tenantId,
    aggregateType: what.aggregateType,
    aggregateId: what.aggregateId,
    sequence: await deps.repository.nextSequence(what.tenantId, what.aggregateId),
    type: what.type,
    version: 1,
    occurredAt: at,
    recordedAt: at,
    source: "api",
  });
  await deps.publisher.publish(event, what.payload, what.topic);
}
