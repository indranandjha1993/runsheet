import { describe, expect, it } from "vitest";
import { renderStop, renderSummary } from "./screen.js";
import { translator } from "../domain/locale.js";
import { runsheetFrom, type Runsheet, type Stop, type StopAction } from "../domain/runsheet.js";

const sheet = (): Runsheet =>
  runsheetFrom({
    runId: "run-1",
    workerId: "w1",
    stops: [
      {
        id: "s1",
        sequence: 1,
        name: "Aarav Sharma",
        address: ["Flat 402", "Noida 201309"],
        actions: [
          {
            id: "a1",
            kind: "deliver",
            consignmentId: "c1",
            barcode: "RS0000000013",
            proofRequirement: "signature",
            codAmountMinor: 149900,
            codCurrency: "INR",
          },
        ],
      },
    ],
  });

function stop(): Stop {
  const first = sheet().stops[0];
  if (first === undefined) throw new Error("the fixture has no stops");
  return first;
}

function firstAction(): StopAction {
  const action = stop().actions[0];
  if (action === undefined) throw new Error("the fixture stop has no actions");
  return action;
}

describe("a stop on screen", () => {
  it("shows who and where before anything else", () => {
    const view = renderStop(stop(), translator("en"));

    expect(view.title).toBe("Aarav Sharma");
    expect(view.address).toEqual(["Flat 402", "Noida 201309"]);
  });

  it("says the money out loud when there is money to take", () => {
    expect(renderStop(stop(), translator("en")).cash).toBe("Collect 1499.00 INR");
  });

  it("says nothing about money when there is none", () => {
    const free = { ...stop(), actions: [{ ...firstAction(), codAmountMinor: undefined }] };

    expect(renderStop(free, translator("en")).cash).toBeUndefined();
  });

  it("says what proof this stop needs", () => {
    expect(renderStop(stop(), translator("en")).proof).toBe("This stop needs a signature");
  });

  it("isolates the barcode so it reads correctly inside Arabic", () => {
    const view = renderStop(stop(), translator("ar"));

    expect(view.barcode.startsWith("⁦")).toBe(true);
    expect(view.barcode).toContain("RS0000000013");
  });

  it("lays out right to left in Arabic and left to right in Hindi", () => {
    expect(renderStop(stop(), translator("ar")).direction).toBe("rtl");
    expect(renderStop(stop(), translator("hi")).direction).toBe("ltr");
  });

  it("translates the actions a driver can take", () => {
    const view = renderStop(stop(), translator("hi"));

    expect(view.actions.map((action) => action.label)).toEqual([
      "पहुँचा दिया",
      "पहुँचा नहीं सके",
      "अभी छोड़ें",
    ]);
  });
});

describe("the summary line", () => {
  it("counts what is left in the driver's language", () => {
    expect(renderSummary(sheet(), 0, translator("en")).progress).toBe("1 stops left");
  });

  it("says the day is done when it is", () => {
    const done = { ...sheet(), stops: [{ ...stop(), state: "done" as const }] };

    expect(renderSummary(done, 0, translator("en")).progress).toBe("Nothing left to do");
  });

  it("shows what is still waiting to send", () => {
    expect(renderSummary(sheet(), 3, translator("en")).pending).toBe("3 waiting to send");
  });

  it("says everything is sent when nothing is waiting", () => {
    expect(renderSummary(sheet(), 0, translator("en")).pending).toBe("Everything sent");
  });

  it("survives a language that makes every string a third longer", () => {
    const grown = renderSummary(sheet(), 3, translator("xx"));

    expect(grown.progress.length).toBeGreaterThan(
      renderSummary(sheet(), 3, translator("en")).progress.length,
    );
    expect(grown.progress).toContain("1");
  });
});
