import { compose } from "../domain/notification.js";
import {
  makePromise,
  publicView,
  updateEta,
  type Promise as DeliveryPromise,
  type PublicView,
} from "../domain/promise.js";
import { issueToken, readToken } from "../domain/token.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { Notification, PromiseDeps } from "./ports.js";

export interface PromiseCommand {
  readonly tenantId: string;
  readonly consignmentId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly locale: string;
}

export async function promiseDelivery(
  deps: PromiseDeps,
  command: PromiseCommand,
): Promise<{ promise: DeliveryPromise; trackingToken: string }> {
  const promise = makePromise({
    consignmentId: command.consignmentId,
    tenantId: command.tenantId,
    windowStart: command.windowStart,
    windowEnd: command.windowEnd,
    at: deps.clock.now(),
  });

  await deps.repository.save(promise);
  await announce(deps, {
    tenantId: promise.tenantId,
    aggregateType: "promise",
    aggregateId: promise.consignmentId,
    type: "promise.updated",
    topic: "promise",
    payload: {
      window_start: promise.windowStart.toISOString(),
      window_end: promise.windowEnd.toISOString(),
    },
  });

  return {
    promise,
    trackingToken: issueToken({
      consignmentId: promise.consignmentId,
      tenantId: promise.tenantId,
      secret: deps.signingSecret,
      issuedAt: deps.clock.now(),
      validHours: deps.trackingValidHours,
    }),
  };
}

export interface EtaCommand {
  readonly tenantId: string;
  readonly consignmentId: string;
  readonly eta: Date;
  readonly locale: string;
  readonly channel: string;
}

function windowText(promise: DeliveryPromise): string {
  return `${promise.windowStart.toISOString()} and ${promise.windowEnd.toISOString()}`;
}

// The customer hears from us when something changed that they would want to act on, and not
// otherwise. Silence is a feature: a message about a four-minute slip trains people to ignore
// the message about a four-hour one.
export async function reportEta(deps: PromiseDeps, command: EtaCommand): Promise<DeliveryPromise> {
  const known = await deps.repository.byConsignment(command.tenantId, command.consignmentId);
  if (known === undefined)
    throw new DomainError("not_found", "nothing was promised for that consignment");

  const updated = updateEta(known, { eta: command.eta, at: deps.clock.now() });
  await deps.repository.save(updated);

  if (updated.notifiable) {
    await notify(deps, {
      promise: updated,
      locale: command.locale,
      channel: command.channel,
      template: "running_late",
      values: { window: windowText(updated), eta: command.eta.toISOString() },
    });
  }

  return updated;
}

interface NotifyRequest {
  readonly promise: DeliveryPromise;
  readonly locale: string;
  readonly channel: string;
  readonly template: string;
  readonly values: Record<string, string>;
}

function recordOf(
  request: NotifyRequest,
  id: string,
): Omit<Notification, "sentAt" | "failedReason"> {
  return {
    id,
    tenantId: request.promise.tenantId,
    consignmentId: request.promise.consignmentId,
    channel: request.channel,
    template: request.template,
    locale: request.locale,
  };
}

async function announceNotification(
  deps: PromiseDeps,
  request: NotifyRequest,
  outcome: "sent" | "failed",
): Promise<void> {
  await announce(deps, {
    tenantId: request.promise.tenantId,
    aggregateType: "promise",
    aggregateId: request.promise.consignmentId,
    type: `notification.${outcome}`,
    topic: "promise",
    payload: { template: request.template, channel: request.channel, locale: request.locale },
  });
}

// A message we could not send is recorded as failed, never silently dropped: somebody has to be
// able to see that the customer was not told.
async function notify(deps: PromiseDeps, request: NotifyRequest): Promise<void> {
  const record = recordOf(request, deps.ids.next());
  const text = compose({
    template: request.template,
    locale: request.locale,
    values: request.values,
  });

  try {
    await deps.messenger.send({ channel: request.channel, text, locale: request.locale });
    await deps.repository.recordNotification({ ...record, sentAt: deps.clock.now() });
    await announceNotification(deps, request, "sent");
  } catch (error) {
    await deps.repository.recordNotification({
      ...record,
      failedReason: error instanceof Error ? error.message : "unknown",
    });
    await announceNotification(deps, request, "failed");
  }
}

export interface SettleCommand {
  readonly tenantId: string;
  readonly consignmentId: string;
  readonly milestone: string;
  readonly locale: string;
  readonly channel: string;
  readonly reason?: string;
}

export async function settle(deps: PromiseDeps, command: SettleCommand): Promise<DeliveryPromise> {
  const known = await deps.repository.byConsignment(command.tenantId, command.consignmentId);
  if (known === undefined)
    throw new DomainError("not_found", "nothing was promised for that consignment");

  const settled = { ...known, settled: true, lastMilestone: command.milestone, notifiable: false };
  await deps.repository.save(settled);

  await notify(deps, {
    promise: settled,
    locale: command.locale,
    channel: command.channel,
    template: command.milestone === "delivered" ? "delivered" : "attempt_failed",
    values: command.reason === undefined ? {} : { reason: command.reason },
  });

  return settled;
}

// Anyone holding the link. There is no account behind this, so the token is the credential and
// the view is deliberately thin.
export async function viewByToken(
  deps: PromiseDeps,
  token: string,
): Promise<PublicView | undefined> {
  const contents = readToken(token, deps.signingSecret, deps.clock.now());
  if (contents === undefined) return undefined;

  const promise = await deps.repository.byConsignment(contents.tenantId, contents.consignmentId);
  return promise === undefined ? undefined : publicView(promise);
}
