import { applyToException, type Exception, type ExceptionEvent } from "../domain/exception.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { ExceptionsDeps } from "./ports.js";

export interface WorkCommand {
  readonly tenantId: string;
  readonly exceptionId: string;
  readonly event: ExceptionEvent;
}

export async function work(deps: ExceptionsDeps, command: WorkCommand): Promise<Exception> {
  const found = await deps.repository.byId(command.tenantId, command.exceptionId);
  if (found === undefined) {
    throw new DomainError("not_found", "no exception with that identifier");
  }

  const next = applyToException(found, command.event);
  await deps.repository.save(next);

  await announce(deps, {
    tenantId: next.tenantId,
    aggregateType: "exception",
    aggregateId: next.id,
    type: `exception.${command.event.type}`,
    topic: "exception",
    payload: { state: next.state, sla_breached: next.slaBreached },
  });

  return next;
}
