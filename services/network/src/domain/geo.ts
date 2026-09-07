export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Edge {
  readonly from: GeoPoint;
  readonly to: GeoPoint;
}

export interface Polygon {
  readonly ring: readonly GeoPoint[];
  readonly edges: readonly Edge[];
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
  const [first, ...rest] = isClosed(ring) ? ring.slice(0, -1) : ring;
  if (first === undefined || rest.length < 2) {
    throw new Error("a polygon needs at least three points");
  }

  const edges: Edge[] = [];
  let previous = first;
  for (const current of rest) {
    edges.push({ from: previous, to: current });
    previous = current;
  }
  edges.push({ from: previous, to: first });

  return { ring: [first, ...rest], edges };
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
  let inside = false;
  for (const edge of shape.edges) {
    if (onSegment(edge.from, edge.to, p)) return true;
    if (crossesRay(edge.from, edge.to, p)) inside = !inside;
  }
  return inside;
}
