import { isolate, type Direction, type Translator } from "../domain/locale.js";
import { money } from "@runsheet/kernel";
import { progress, type Runsheet, type Stop } from "../domain/runsheet.js";

export interface ActionButton {
  readonly key: "deliver" | "fail" | "skip";
  readonly label: string;
}

export interface StopView {
  readonly title: string;
  readonly address: readonly string[];
  readonly barcode: string;
  readonly proof?: string;
  readonly cash?: string;
  readonly direction: Direction;
  readonly actions: readonly ActionButton[];
}

function cashOn(stop: Stop): string | undefined {
  const due = stop.actions.reduce((total, action) => total + (action.codAmountMinor ?? 0), 0);
  if (due === 0) return undefined;
  const currency = stop.actions.find((action) => action.codCurrency !== undefined)?.codCurrency;
  return money(due, currency ?? "INR").toString();
}

export function renderStop(stop: Stop, t: Translator): StopView {
  const cash = cashOn(stop);
  const requirement = stop.actions.find((action) => action.proofRequirement !== "none");
  const barcode = stop.actions[0]?.barcode ?? "";

  return {
    title: stop.name,
    address: stop.address,
    // A barcode is read out and typed in. Inside a right-to-left sentence it must not be
    // reordered by the words around it.
    barcode: isolate(barcode),
    ...(requirement === undefined
      ? {}
      : {
          // Grammar is never assembled from parts. Each language names the proof its own way.
          proof: t("proof.required", { kind: t(`proof.kind.${requirement.proofRequirement}`) }),
        }),
    ...(cash === undefined ? {} : { cash: t("cash.collect", { amount: cash }) }),
    direction: t.direction,
    actions: [
      { key: "deliver", label: t("action.deliver") },
      { key: "fail", label: t("action.fail") },
      { key: "skip", label: t("action.skip") },
    ],
  };
}

export interface SummaryView {
  readonly progress: string;
  readonly pending: string;
  readonly direction: Direction;
}

export function renderSummary(sheet: Runsheet, waiting: number, t: Translator): SummaryView {
  const counted = progress(sheet);

  return {
    progress: counted.finished
      ? t("stops.none")
      : t("stops.remaining", { count: String(counted.remaining) }),
    pending: waiting === 0 ? t("app.synced") : t("app.pending", { count: String(waiting) }),
    direction: t.direction,
  };
}
