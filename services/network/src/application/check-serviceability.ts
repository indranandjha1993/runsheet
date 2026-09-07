import { arrivalFor } from "../domain/lane.js";
import { point } from "../domain/geo.js";
import { resolveZone } from "../domain/zone.js";
import type { NetworkRepository } from "./ports.js";

export type NotServiceable =
  | "no_zone_covers_this_location"
  | "zone_points_at_a_missing_hub"
  | "service_not_offered_from_this_hub";

export interface ServiceabilityAnswer {
  readonly serviceable: boolean;
  readonly zoneId?: string;
  readonly hubCode?: string;
  readonly estimatedArrival?: Date;
  readonly reason?: NotServiceable;
}

export interface CheckServiceabilityQuery {
  readonly tenantId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly service: string;
  readonly at: Date;
}

export async function checkServiceability(
  deps: { readonly repository: NetworkRepository },
  query: CheckServiceabilityQuery,
): Promise<ServiceabilityAnswer> {
  const zones = await deps.repository.zonesFor(query.tenantId);
  const zone = resolveZone(zones, point(query.latitude, query.longitude));
  if (zone === undefined) {
    return { serviceable: false, reason: "no_zone_covers_this_location" };
  }

  const serving = await deps.repository.hubById(query.tenantId, zone.hubId);
  if (serving === undefined) {
    return { serviceable: false, zoneId: zone.id, reason: "zone_points_at_a_missing_hub" };
  }

  const lanes = await deps.repository.lanesFrom(query.tenantId, zone.hubId);
  const usable = lanes.find((candidate) => candidate.service === query.service);
  if (usable === undefined) {
    return {
      serviceable: false,
      zoneId: zone.id,
      hubCode: serving.code,
      reason: "service_not_offered_from_this_hub",
    };
  }

  return {
    serviceable: true,
    zoneId: zone.id,
    hubCode: serving.code,
    estimatedArrival: arrivalFor(usable, query.at),
  };
}
