import { money, type Money } from "@runsheet/kernel";
import { DomainError } from "./errors.js";

export type CashAccount = "driver_float" | "merchant_payable";

// A collection is cash into a driver's hands and a debt to the merchant. A deposit clears the
// driver only. A remittance clears the merchant only. A written-off shortfall clears the driver
// without paying the merchant, which is the carrier absorbing the loss.
export type MovementKind = "collected" | "deposited" | "remitted" | "written_off" | "reversed";

export interface CashMovement {
  readonly kind: MovementKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly driverId?: string | undefined;
  readonly merchantId?: string | undefined;
  readonly reference: string;
  readonly approvedBy?: string | undefined;
  readonly at: Date;
}

export interface Posting {
  readonly account: CashAccount;
  readonly driverId?: string;
  readonly merchantId?: string;
  readonly deltaMinor: number;
}

export interface CashEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: MovementKind;
  readonly account: CashAccount;
  readonly driverId?: string;
  readonly merchantId?: string;
  readonly deltaMinor: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reference: string;
  readonly approvedBy?: string;
  readonly at: Date;
}

function driverPosting(driverId: string, deltaMinor: number): Posting {
  return { account: "driver_float", driverId, deltaMinor };
}

function merchantPosting(merchantId: string, deltaMinor: number): Posting {
  return { account: "merchant_payable", merchantId, deltaMinor };
}

function requireDriver(movement: CashMovement): string {
  if (movement.driverId === undefined || movement.driverId === "") {
    throw new DomainError("invalid_input", "this movement must name the driver");
  }
  return movement.driverId;
}

function requireMerchant(movement: CashMovement): string {
  if (movement.merchantId === undefined || movement.merchantId === "") {
    throw new DomainError("invalid_input", "this movement must name the merchant");
  }
  return movement.merchantId;
}

function bothParties(movement: CashMovement): { driverId: string; merchantId: string } {
  const { driverId, merchantId } = movement;
  if (driverId === undefined || driverId === "" || merchantId === undefined || merchantId === "") {
    throw new DomainError(
      "invalid_input",
      "a collection must name both the driver and the merchant",
    );
  }
  return { driverId, merchantId };
}

const POSTINGS: Record<MovementKind, (movement: CashMovement) => Posting[]> = {
  collected: (movement) => {
    const { driverId, merchantId } = bothParties(movement);
    return [
      driverPosting(driverId, movement.amountMinor),
      merchantPosting(merchantId, movement.amountMinor),
    ];
  },
  reversed: (movement) => {
    const { driverId, merchantId } = bothParties(movement);
    return [
      driverPosting(driverId, -movement.amountMinor),
      merchantPosting(merchantId, -movement.amountMinor),
    ];
  },
  deposited: (movement) => [driverPosting(requireDriver(movement), -movement.amountMinor)],
  written_off: (movement) => [driverPosting(requireDriver(movement), -movement.amountMinor)],
  remitted: (movement) => [merchantPosting(requireMerchant(movement), -movement.amountMinor)],
};

export function postingsFor(movement: CashMovement): Posting[] {
  return POSTINGS[movement.kind](movement);
}

// The ledger is append-only. A mistake is corrected by a reversing movement, never by editing or
// removing an entry, so the history of who held what cash when stays intact for an audit.
export function entryFor(id: string, tenantId: string, movement: CashMovement): CashEntry[] {
  if (!Number.isInteger(movement.amountMinor) || movement.amountMinor <= 0) {
    throw new DomainError("invalid_input", "a cash movement must be a positive amount");
  }
  if (movement.reference.trim() === "") {
    throw new DomainError("invalid_input", "a cash movement must name what it came from");
  }

  return postingsFor(movement).map((posting, index) => ({
    id: `${id}:${String(index)}`,
    tenantId,
    kind: movement.kind,
    account: posting.account,
    ...(posting.driverId === undefined ? {} : { driverId: posting.driverId }),
    ...(posting.merchantId === undefined ? {} : { merchantId: posting.merchantId }),
    deltaMinor: posting.deltaMinor,
    amountMinor: movement.amountMinor,
    currency: movement.currency,
    reference: movement.reference,
    ...(movement.approvedBy === undefined ? {} : { approvedBy: movement.approvedBy }),
    at: movement.at,
  }));
}

function balance(
  entries: readonly CashEntry[],
  currency: string,
  matches: (entry: CashEntry) => boolean,
): Money {
  const total = entries
    .filter((entry) => entry.currency === currency && matches(entry))
    .reduce((sum, entry) => sum + entry.deltaMinor, 0);
  return money(total, currency);
}

export function driverFloat(
  entries: readonly CashEntry[],
  driverId: string,
  currency: string,
): Money {
  return balance(
    entries,
    currency,
    (entry) => entry.account === "driver_float" && entry.driverId === driverId,
  );
}

export function merchantPayable(
  entries: readonly CashEntry[],
  merchantId: string,
  currency: string,
): Money {
  return balance(
    entries,
    currency,
    (entry) => entry.account === "merchant_payable" && entry.merchantId === merchantId,
  );
}
