export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Polygon {
  readonly ring: readonly GeoPoint[];
}

const EPSILON = 1e-9;

export function point(latitude: number, longitude: number): GeoPoint {
  if (latitude < -90 || latitude > 90) {
    throw new Error("latitude must be between -90 and 90");
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error("longitude must be between -180 and 180");
  }
  return { latitude, longitude };
}

function isClosed(ring: readonly GeoPoint[]): boolean {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first?.latitude === last?.latitude && first?.longitude === last?.longitude;
}

export function polygon(points: readonly (readonly [number, number])[]): Polygon {
  const ring = points.map(([latitude, longitude]) => point(latitude, longitude));
  const distinct = isClosed(ring) ? ring.slice(0, -1) : ring;
  if (distinct.length < 3) {
    throw new Error("a polygon needs at least three points");
  }
  return { ring: distinct };
}

function onSegment(a: GeoPoint, b: GeoPoint, p: GeoPoint): boolean {
  const cross =
    (b.longitude - a.longitude) * (p.latitude - a.latitude) -
    (b.latitude - a.latitude) * (p.longitude - a.longitude);
  if (Math.abs(cross) > EPSILON) return false;

  const withinLatitude =
    p.latitude >= Math.min(a.latitude, b.latitude) - EPSILON &&
    p.latitude <= Math.max(a.latitude, b.latitude) + EPSILON;
  const withinLongitude =
    p.longitude >= Math.min(a.longitude, b.longitude) - EPSILON &&
    p.longitude <= Math.max(a.longitude, b.longitude) + EPSILON;
  return withinLatitude && withinLongitude;
}

function crossesRay(a: GeoPoint, b: GeoPoint, p: GeoPoint): boolean {
  if (a.latitude > p.latitude === b.latitude > p.latitude) return false;
  const at =
    ((b.longitude - a.longitude) * (p.latitude - a.latitude)) / (b.latitude - a.latitude) +
    a.longitude;
  return p.longitude < at;
}

// A point on the boundary counts as inside, so two zones sharing an edge leave no gap between
// them. Everything else is the standard ray cast.
export function contains(shape: Polygon, p: GeoPoint): boolean {
  const ring = shape.ring;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    if (onSegment(a, b, p)) return true;
    if (crossesRay(a, b, p)) inside = !inside;
  }
  return inside;
}
