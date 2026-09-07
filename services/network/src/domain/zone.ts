import { contains, type GeoPoint, type Polygon } from "./geo.js";

export interface Zone {
  readonly id: string;
  readonly hubId: string;
  readonly priority: number;
  readonly boundary: Polygon;
  readonly active: boolean;
}

// Zones overlap in practice: a courier draws a wide zone for a city and a tighter one for a
// gated community inside it. Higher priority wins. A tie falls back to the identifier so the
// answer never depends on the order rows came out of the database.
function better(candidate: Zone, current: Zone): boolean {
  if (candidate.priority !== current.priority) return candidate.priority > current.priority;
  return candidate.id < current.id;
}

export function resolveZone(zones: readonly Zone[], at: GeoPoint): Zone | undefined {
  let best: Zone | undefined;
  for (const zone of zones) {
    if (!zone.active) continue;
    if (!contains(zone.boundary, at)) continue;
    if (best === undefined || better(zone, best)) best = zone;
  }
  return best;
}
