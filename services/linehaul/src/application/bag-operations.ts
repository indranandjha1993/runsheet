import { apply, openBag, type Bag, type BagEvent } from "../domain/bag.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { LinehaulDeps } from "./ports.js";

async function announceBag(
  deps: LinehaulDeps,
  bag: Bag,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await announce(deps, {
    tenantId: bag.tenantId,
    aggregateType: "bag",
    aggregateId: bag.id,
    type,
    topic: "linehaul",
    payload,
  });
}

export async function loadBagOrFail(
  deps: LinehaulDeps,
  tenantId: string,
  bagId: string,
): Promise<{ bag: Bag; version: number }> {
  const found = await deps.repository.bagById(tenantId, bagId);
  if (found === undefined) throw new DomainError("not_found", "no bag with that identifier");
  return found;
}

export interface BagParcelCommand {
  readonly tenantId: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
  readonly consignmentId: string;
}

// A hub keeps one open bag per destination. Opening a second would split a lane's parcels
// across bags for no reason and make the far end reconcile twice.
export async function bagParcel(deps: LinehaulDeps, command: BagParcelCommand): Promise<Bag> {
  const existing = await deps.repository.openBagFor(
    command.tenantId,
    command.originHubId,
    command.destinationHubId,
  );

  const before =
    existing ??
    openBag({
      id: deps.ids.next(),
      tenantId: command.tenantId,
      originHubId: command.originHubId,
      destinationHubId: command.destinationHubId,
    });
  const version =
    existing === undefined ? 0 : (await loadBagOrFail(deps, command.tenantId, before.id)).version;

  const bag = apply(before, { type: "parcel_added", consignmentId: command.consignmentId });
  await deps.repository.saveBag(bag, version);
  await announceBag(deps, bag, "bag.parcel_added", {
    consignment_id: command.consignmentId,
    origin_hub_id: bag.originHubId,
    destination_hub_id: bag.destinationHubId,
  });

  return bag;
}

export interface SealBagCommand {
  readonly tenantId: string;
  readonly bagId: string;
  readonly sealNumber: string;
}

export async function sealBag(deps: LinehaulDeps, command: SealBagCommand): Promise<Bag> {
  return recordBagEvent(deps, {
    tenantId: command.tenantId,
    bagId: command.bagId,
    event: { type: "sealed", sealNumber: command.sealNumber },
  });
}

export interface RecordBagEventCommand {
  readonly tenantId: string;
  readonly bagId: string;
  readonly event: BagEvent;
}

function discrepancy(bag: Bag): Record<string, unknown> | undefined {
  if (bag.missingIds.length === 0 && bag.unexpectedIds.length === 0 && !bag.misrouted) {
    return undefined;
  }
  return {
    bag_id: bag.id,
    missing_consignment_ids: bag.missingIds,
    unexpected_consignment_ids: bag.unexpectedIds,
    misrouted: bag.misrouted,
  };
}

export async function recordBagEvent(
  deps: LinehaulDeps,
  command: RecordBagEventCommand,
): Promise<Bag> {
  const found = await loadBagOrFail(deps, command.tenantId, command.bagId);
  const bag = apply(found.bag, command.event);
  await deps.repository.saveBag(bag, found.version);

  await announceBag(deps, bag, `bag.${command.event.type}`, {
    bag_id: bag.id,
    status: bag.status,
  });

  // A broken seal means every parcel inside needs checking, whatever the count says.
  if (command.event.type === "received" && bag.sealBroken) {
    await announceBag(deps, bag, "bag.seal_broken", {
      bag_id: bag.id,
      seal_number: bag.sealNumber ?? "unsealed",
      consignment_ids: bag.consignmentIds,
    });
  }

  const found_discrepancy = discrepancy(bag);
  if (command.event.type === "emptied" && found_discrepancy !== undefined) {
    await announceBag(deps, bag, "bag.discrepancy_found", found_discrepancy);
  }

  return bag;
}
