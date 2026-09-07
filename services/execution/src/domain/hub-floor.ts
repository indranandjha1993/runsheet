import { DomainError } from "./errors.js";

// Our own labels. Anything else at a hub belongs to somebody, but not to us.
const BARCODE = /^RS[0-9]{10}$/;

// How much heavier a parcel may weigh at the hub than at booking before somebody checks. Under
// this, it is scales and packaging. Over it, either the booking was wrong or the parcel is not
// what was booked, and both matter for what the carrier can bill.
const WEIGHT_ALLOWANCE_GRAMS = 100;

// The industry divisor for turning size into a billable weight.
const VOLUMETRIC_DIVISOR = 5000;

export interface ScanContext {
  readonly tenantId: string;
  readonly hubId: string;
  readonly workerId: string;
  readonly at: Date;
}

export interface Dimensions {
  readonly length: number;
  readonly width: number;
  readonly height: number;
}

export interface ScanInCommand {
  readonly consignmentId: string;
  readonly expected: boolean;
  readonly barcode: string;
  readonly weightGrams?: number;
  readonly bookedWeightGrams?: number;
  readonly dimensionsMm?: Dimensions;
}

export interface Scan {
  readonly tenantId: string;
  readonly hubId: string;
  readonly workerId: string;
  readonly consignmentId: string;
  readonly at: Date;
  readonly accepted: boolean;
  readonly weightGrams?: number;
  readonly volumetricGrams?: number;
  readonly exception?: string;
}

function assertScannable(consignmentId: string, barcode: string): void {
  if (consignmentId.trim() === "") {
    throw new DomainError("invalid_input", "a scan needs a consignment");
  }
  if (!BARCODE.test(barcode)) {
    throw new DomainError("invalid_input", "that barcode is not a Runsheet label");
  }
}

function volumetricOf(dimensions: Dimensions | undefined): number | undefined {
  if (dimensions === undefined) return undefined;
  const cubicCm = (dimensions.length * dimensions.width * dimensions.height) / 1000;
  return Math.round((cubicCm / VOLUMETRIC_DIVISOR) * 1000);
}

function weightProblem(command: ScanInCommand): string | undefined {
  const { weightGrams, bookedWeightGrams } = command;
  if (weightGrams === undefined || bookedWeightGrams === undefined) return undefined;
  return Math.abs(weightGrams - bookedWeightGrams) > WEIGHT_ALLOWANCE_GRAMS
    ? "weight_differs_from_booking"
    : undefined;
}

// A parcel physically at the hub is accepted whatever the system thought. Refusing it would leave
// it on the floor with nobody responsible; flagging it puts somebody on it.
export function scanIn(context: ScanContext, command: ScanInCommand): Scan {
  assertScannable(command.consignmentId, command.barcode);

  const exception = command.expected ? weightProblem(command) : "unexpected_parcel";
  const volumetricGrams = volumetricOf(command.dimensionsMm);

  return {
    tenantId: context.tenantId,
    hubId: context.hubId,
    workerId: context.workerId,
    consignmentId: command.consignmentId,
    at: context.at,
    accepted: true,
    ...(command.weightGrams === undefined ? {} : { weightGrams: command.weightGrams }),
    ...(volumetricGrams === undefined ? {} : { volumetricGrams }),
    ...(exception === undefined ? {} : { exception }),
  };
}

export interface ScanOutCommand {
  readonly consignmentId: string;
  readonly runId: string;
  readonly onRun: boolean;
  readonly barcode: string;
}

// Loading a parcel onto a run it is not on is how parcels disappear. This one is refused.
export function scanOut(context: ScanContext, command: ScanOutCommand): Scan {
  assertScannable(command.consignmentId, command.barcode);

  return {
    tenantId: context.tenantId,
    hubId: context.hubId,
    workerId: context.workerId,
    consignmentId: command.consignmentId,
    at: context.at,
    accepted: command.onRun,
    ...(command.onRun ? {} : { exception: "not_on_this_run" }),
  };
}
