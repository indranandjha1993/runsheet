import { DomainError } from "./errors.js";

export interface ManifestTrip {
  readonly id: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
  readonly departsOn: string;
  readonly vehicleId?: string | undefined;
  readonly driverId?: string | undefined;
}

export interface ManifestBag {
  readonly id: string;
  readonly sealNumber?: string | undefined;
  readonly destinationHubId: string;
  readonly consignmentIds: readonly string[];
}

export interface ManifestLine {
  readonly bagId: string;
  readonly sealNumber: string;
  readonly destinationHubId: string;
  readonly parcelCount: number;
}

export interface Manifest {
  readonly tripId: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
  readonly departsOn: string;
  readonly vehicleId?: string;
  readonly driverId?: string;
  readonly bags: readonly ManifestLine[];
  readonly parcelCount: number;
  readonly onwardBagIds: readonly string[];
}

// The manifest is the paper the driver hands over. It has to be checkable without opening a
// bag, so it carries seals and counts rather than parcel numbers.
export function manifestFor(trip: ManifestTrip, bags: readonly ManifestBag[]): Manifest {
  if (bags.length === 0) {
    throw new DomainError("invalid_input", "a trip carrying nothing has no manifest");
  }

  return {
    tripId: trip.id,
    originHubId: trip.originHubId,
    destinationHubId: trip.destinationHubId,
    departsOn: trip.departsOn,
    ...(trip.vehicleId === undefined ? {} : { vehicleId: trip.vehicleId }),
    ...(trip.driverId === undefined ? {} : { driverId: trip.driverId }),
    bags: bags.map((bag) => ({
      bagId: bag.id,
      sealNumber: bag.sealNumber ?? "unsealed",
      destinationHubId: bag.destinationHubId,
      parcelCount: bag.consignmentIds.length,
    })),
    parcelCount: bags.reduce((total, bag) => total + bag.consignmentIds.length, 0),
    onwardBagIds: bags
      .filter((bag) => bag.destinationHubId !== trip.destinationHubId)
      .map((bag) => bag.id),
  };
}

export interface Reconciliation {
  readonly agreed: boolean;
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];
}

export function reconcile(manifest: Manifest, scannedBagIds: readonly string[]): Reconciliation {
  const expected = manifest.bags.map((line) => line.bagId);
  const scanned = new Set(scannedBagIds);
  const missing = expected.filter((id) => !scanned.has(id));
  const unexpected = [...scanned].filter((id) => !expected.includes(id));

  return { agreed: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}
