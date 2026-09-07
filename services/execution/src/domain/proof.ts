import { DomainError } from "./errors.js";

export type ProofKind = "photo" | "signature" | "otp" | "geofence";

export interface CaptureProofCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly consignmentId: string;
  readonly requirement: string;
  readonly kinds: readonly ProofKind[];
  readonly capturedAt: Date;
  readonly mediaIds: readonly string[];
  readonly geofenceOk?: boolean;
}

export interface Proof extends CaptureProofCommand {
  readonly satisfiesRequirement: boolean;
}

// What each named requirement demands. A tenant picks one at booking and it is frozen onto the
// consignment, so changing this table never alters what an old delivery required.
const REQUIREMENTS: Record<string, readonly ProofKind[]> = {
  none: [],
  photo: ["photo"],
  signature: ["signature"],
  otp: ["otp"],
  photo_and_otp: ["photo", "otp"],
  photo_and_signature: ["photo", "signature"],
  photo_and_geofence: ["photo", "geofence"],
};

export function capture(command: CaptureProofCommand): Proof {
  const demanded = REQUIREMENTS[command.requirement];
  if (demanded === undefined) {
    throw new DomainError("invalid_input", `unknown proof requirement: ${command.requirement}`);
  }
  if (command.kinds.includes("photo") && command.mediaIds.length === 0) {
    throw new DomainError("invalid_input", "a photo proof needs at least one media reference");
  }

  const supplied = new Set<ProofKind>(command.kinds);
  if (command.geofenceOk === true) supplied.add("geofence");

  return {
    ...command,
    satisfiesRequirement: demanded.every((kind) => supplied.has(kind)),
  };
}
