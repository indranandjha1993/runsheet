import { envelope } from "@runsheet/kernel";
import { routingFor } from "@runsheet/contracts";
import type { ExecutionDeps } from "./ports.js";

export async function announce(
  deps: ExecutionDeps,
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
  const routing = routingFor(what.type, what.topic);
  await deps.publisher.publish(event, what.payload, routing.topic);
}
