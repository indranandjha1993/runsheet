// What the driver holds for the shift. It is the whole day, downloaded once, worked through with
// no network, and it never asks the server a question it cannot answer on its own.

export type StopState = "open" | "done" | "failed" | "skipped";
export type ActionKind = "deliver" | "pickup" | "return";

export interface StopAction {
  readonly id: string;
  readonly kind: ActionKind;
  readonly consignmentId: string;
  readonly barcode: string;
  readonly proofRequirement: string;
  readonly codAmountMinor?: number | undefined;
  readonly codCurrency?: string | undefined;
}

export interface Stop {
  readonly id: string;
  readonly sequence: number;
  readonly name: string;
  readonly address: readonly string[];
  readonly actions: readonly StopAction[];
  readonly state: StopState;
  readonly reason?: string;
  readonly proofId?: string;
  readonly cashCollectedMinor?: number;
}

export interface Runsheet {
  readonly runId: string;
  readonly workerId: string;
  readonly stops: readonly Stop[];
}

export interface RunsheetInput {
  readonly runId: string;
  readonly workerId: string;
  readonly stops: readonly Omit<Stop, "state">[];
}

export function runsheetFrom(input: RunsheetInput): Runsheet {
  return {
    runId: input.runId,
    workerId: input.workerId,
    stops: [...input.stops]
      .sort((a, b) => a.sequence - b.sequence)
      .map((stop) => ({ ...stop, state: "open" as const })),
  };
}

export function nextStop(sheet: Runsheet): Stop | undefined {
  return sheet.stops.find((stop) => stop.state === "open");
}

export interface Progress {
  readonly done: number;
  readonly failed: number;
  readonly remaining: number;
  readonly finished: boolean;
}

// A skipped stop still counts as remaining. The driver has to go back to it, and a count that
// said otherwise would let a run be closed with parcels still on the vehicle.
export function progress(sheet: Runsheet): Progress {
  const count = (state: StopState): number =>
    sheet.stops.filter((stop) => stop.state === state).length;

  const remaining = count("open") + count("skipped");
  return { done: count("done"), failed: count("failed"), remaining, finished: remaining === 0 };
}

function locate(sheet: Runsheet, stopId: string): Stop {
  const stop = sheet.stops.find((one) => one.id === stopId);
  if (stop === undefined) throw new Error("no stop with that identifier");
  return stop;
}

function replace(sheet: Runsheet, next: Stop): Runsheet {
  return {
    ...sheet,
    stops: sheet.stops.map((stop) => (stop.id === next.id ? next : stop)),
  };
}

function assertOpen(stop: Stop): void {
  if (stop.state === "done" || stop.state === "failed") {
    throw new Error("that stop is already closed");
  }
}

export interface CompleteInput {
  readonly proofId?: string;
  readonly cashCollectedMinor?: number;
}

function cashDue(stop: Stop): number {
  return stop.actions.reduce((total, action) => total + (action.codAmountMinor ?? 0), 0);
}

function proofNeeded(stop: Stop): string | undefined {
  return stop.actions.find((action) => action.proofRequirement !== "none")?.proofRequirement;
}

export function complete(sheet: Runsheet, stopId: string, input: CompleteInput): Runsheet {
  const stop = locate(sheet, stopId);
  assertOpen(stop);

  const needed = proofNeeded(stop);
  if (needed !== undefined && input.proofId === undefined) {
    throw new Error(`this stop needs a ${needed}`);
  }

  const due = cashDue(stop);
  if (due > 0 && (input.cashCollectedMinor ?? 0) <= 0) {
    throw new Error("this stop has cash to collect");
  }

  return replace(sheet, {
    ...stop,
    state: "done",
    ...(input.proofId === undefined ? {} : { proofId: input.proofId }),
    ...(input.cashCollectedMinor === undefined
      ? {}
      : { cashCollectedMinor: input.cashCollectedMinor }),
  });
}

export function fail(sheet: Runsheet, stopId: string, reason: string): Runsheet {
  const stop = locate(sheet, stopId);
  assertOpen(stop);
  if (reason.trim() === "") throw new Error("a failed stop needs a reason");

  return replace(sheet, { ...stop, state: "failed", reason });
}

export function skip(sheet: Runsheet, stopId: string, reason: string): Runsheet {
  const stop = locate(sheet, stopId);
  assertOpen(stop);
  if (reason.trim() === "") throw new Error("a skipped stop needs a reason");

  return replace(sheet, { ...stop, state: "skipped", reason });
}
