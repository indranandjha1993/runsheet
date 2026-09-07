import {
  driverFloat,
  entryFor,
  merchantPayable,
  type CashEntry,
  type MovementKind,
} from "../domain/cash-ledger.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { CashHolder, MoneyDeps } from "./ports.js";

export interface RecordMovementCommand {
  readonly tenantId: string;
  readonly kind: MovementKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reference: string;
  readonly driverId?: string;
  readonly merchantId?: string;
  readonly approvedBy?: string;
}

export interface Balances {
  readonly driverFloatMinor: number;
  readonly merchantPayableMinor: number;
}

// A movement is identified by what it is and what it came from, so the same delivery reported
// twice by a flaky handset is banked once.
function keyOf(command: RecordMovementCommand): string {
  return `${command.tenantId}:${command.kind}:${command.reference}`;
}

async function balancesFor(
  deps: MoneyDeps,
  command: RecordMovementCommand,
): Promise<Balances> {
  const driverId = command.driverId;
  const merchantId = command.merchantId;
  const forDriver =
    driverId === undefined ? [] : await deps.repository.cashEntriesFor(command.tenantId, { driverId });
  const forMerchant =
    merchantId === undefined
      ? []
      : await deps.repository.cashEntriesFor(command.tenantId, { merchantId });

  return {
    driverFloatMinor:
      driverId === undefined ? 0 : driverFloat(forDriver, driverId, command.currency).minorUnits,
    merchantPayableMinor:
      merchantId === undefined
        ? 0
        : merchantPayable(forMerchant, merchantId, command.currency).minorUnits,
  };
}

async function assertAllowed(deps: MoneyDeps, command: RecordMovementCommand): Promise<void> {
  if (command.kind === "written_off" && (command.approvedBy ?? "") === "") {
    throw new DomainError("invalid_input", "a write-off needs an approver");
  }
  if (command.kind !== "remitted") return;

  const merchantId = command.merchantId ?? "";
  const entries = await deps.repository.cashEntriesFor(command.tenantId, { merchantId });
  const owed = merchantPayable(entries, merchantId, command.currency).minorUnits;
  if (command.amountMinor > owed) {
    throw new DomainError("invalid_input", "that is more than the merchant is owed");
  }
}

export async function recordMovement(
  deps: MoneyDeps,
  command: RecordMovementCommand,
): Promise<Balances> {
  await assertAllowed(deps, command);

  const entries = entryFor(deps.ids.next(), command.tenantId, {
    kind: command.kind,
    amountMinor: command.amountMinor,
    currency: command.currency,
    reference: command.reference,
    at: deps.clock.now(),
    ...(command.driverId === undefined ? {} : { driverId: command.driverId }),
    ...(command.merchantId === undefined ? {} : { merchantId: command.merchantId }),
    ...(command.approvedBy === undefined ? {} : { approvedBy: command.approvedBy }),
  });

  const recorded = await deps.repository.saveCashMovement(keyOf(command), entries);
  if (!recorded) return balancesFor(deps, command);

  await announce(deps, {
    tenantId: command.tenantId,
    aggregateType: "cash",
    aggregateId: command.reference,
    type: `cash.${command.kind}`,
    topic: "money",
    payload: {
      amount_minor: command.amountMinor,
      currency: command.currency,
      reference: command.reference,
      ...(command.driverId === undefined ? {} : { driver_id: command.driverId }),
      ...(command.merchantId === undefined ? {} : { merchant_id: command.merchantId }),
    },
  });

  return balancesFor(deps, command);
}

export interface StatementQuery {
  readonly tenantId: string;
  readonly currency: string;
  readonly driverId?: string;
  readonly merchantId?: string;
}

export interface Statement {
  readonly floatMinor: number;
  readonly payableMinor: number;
  readonly entries: readonly CashEntry[];
}

function holderOf(query: StatementQuery): CashHolder {
  if (query.driverId !== undefined) return { driverId: query.driverId };
  if (query.merchantId !== undefined) return { merchantId: query.merchantId };
  throw new DomainError("invalid_input", "a statement is for one driver or one merchant");
}

export async function statementFor(deps: MoneyDeps, query: StatementQuery): Promise<Statement> {
  const entries = await deps.repository.cashEntriesFor(query.tenantId, holderOf(query));
  return {
    floatMinor:
      query.driverId === undefined
        ? 0
        : driverFloat(entries, query.driverId, query.currency).minorUnits,
    payableMinor:
      query.merchantId === undefined
        ? 0
        : merchantPayable(entries, query.merchantId, query.currency).minorUnits,
    entries,
  };
}

export interface CloseRunCommand {
  readonly tenantId: string;
  readonly runId: string;
  readonly driverId: string;
  readonly currency: string;
  readonly countedMinor: number;
}

export interface RunCashClose {
  readonly expectedMinor: number;
  readonly countedMinor: number;
  readonly varianceMinor: number;
  readonly floatAfterMinor: number;
}

function varianceEvent(variance: number): string | undefined {
  if (variance < 0) return "cash.shortfall_found";
  if (variance > 0) return "cash.surplus_found";
  return undefined;
}

async function announceClose(
  deps: MoneyDeps,
  command: CloseRunCommand,
  close: RunCashClose,
): Promise<void> {
  const { tenantId, runId, driverId, currency } = command;
  const about = { tenantId, aggregateType: "cash", aggregateId: runId, topic: "money" } as const;

  await announce(deps, {
    ...about,
    type: "cash.run_closed",
    payload: { run_id: runId, driver_id: driverId, currency, ...close },
  });

  const variance = varianceEvent(close.varianceMinor);
  if (variance === undefined) return;

  await announce(deps, {
    ...about,
    type: variance,
    payload: {
      run_id: runId,
      driver_id: driverId,
      currency,
      variance_minor: close.varianceMinor,
    },
  });
}

// A shortfall is not written off here. The driver keeps owing it until somebody with the
// authority to absorb the loss approves a write-off.
export async function closeDriverRun(
  deps: MoneyDeps,
  command: CloseRunCommand,
): Promise<RunCashClose> {
  const { tenantId, driverId, currency, countedMinor } = command;
  const before = await deps.repository.cashEntriesFor(tenantId, { driverId });
  const expectedMinor = driverFloat(before, driverId, currency).minorUnits;

  const entries =
    countedMinor === 0
      ? []
      : entryFor(deps.ids.next(), tenantId, {
          kind: "deposited",
          amountMinor: countedMinor,
          currency,
          driverId,
          reference: command.runId,
          at: deps.clock.now(),
        });

  const recorded = await deps.repository.saveCashMovement(
    `${tenantId}:deposited:${command.runId}`,
    entries,
  );
  if (!recorded) {
    throw new DomainError("already_exists", "that run is already closed for cash");
  }

  const varianceMinor = countedMinor - expectedMinor;
  const close: RunCashClose = {
    expectedMinor,
    countedMinor,
    varianceMinor,
    floatAfterMinor: expectedMinor - countedMinor,
  };
  await announceClose(deps, command, close);
  return close;
}
