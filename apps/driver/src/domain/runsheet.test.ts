import { describe, expect, it } from "vitest";
import { complete, fail, nextStop, progress, runsheetFrom, skip, type Runsheet } from "./runsheet.js";

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
      {
        id: "s2",
        sequence: 2,
        name: "Priya Nair",
        address: ["12 MG Road", "Bengaluru 560001"],
        actions: [
          {
            id: "a2",
            kind: "pickup",
            consignmentId: "c2",
            barcode: "RS0000000021",
            proofRequirement: "photo",
          },
        ],
      },
    ],
  });

describe("what the driver sees next", () => {
  it("is the first stop that is still open", () => {
    expect(nextStop(sheet())?.id).toBe("s1");
  });

  it("moves on once a stop is done", () => {
    expect(nextStop(complete(sheet(), "s1", { proofId: "p1", cashCollectedMinor: 149900 }))?.id).toBe("s2");
  });

  it("is nothing when the run is worked out", () => {
    const done = complete(complete(sheet(), "s1", { proofId: "p1", cashCollectedMinor: 149900 }), "s2", {
      proofId: "p2",
    });

    expect(nextStop(done)).toBeUndefined();
  });

  it("skips past a stop the driver put aside, without losing it", () => {
    const put = skip(sheet(), "s1", "gate locked");

    expect(nextStop(put)?.id).toBe("s2");
    expect(put.stops.find((stop) => stop.id === "s1")?.state).toBe("skipped");
  });
});

describe("counting the day", () => {
  it("counts what is left", () => {
    expect(progress(sheet()).remaining).toBe(2);
  });

  it("counts a failed stop as finished, because the driver has been there", () => {
    const after = fail(sheet(), "s1", "customer not in");

    expect(progress(after).remaining).toBe(1);
    expect(progress(after).failed).toBe(1);
  });

  it("counts a skipped stop as still to do, because it has to be gone back to", () => {
    expect(progress(skip(sheet(), "s1", "gate locked")).remaining).toBe(2);
  });

  it("knows the run is finished only when nothing is open", () => {
    expect(progress(sheet()).finished).toBe(false);
    const done = fail(complete(sheet(), "s1", { proofId: "p1", cashCollectedMinor: 149900 }), "s2", "no answer");
    expect(progress(done).finished).toBe(true);
  });
});

describe("what a stop demands before it can be closed", () => {
  it("refuses a delivery with no proof when proof was required", () => {
    expect(() => complete(sheet(), "s1", {})).toThrow("this stop needs a signature");
  });

  it("refuses cash on delivery closed without the money", () => {
    expect(() => complete(sheet(), "s1", { proofId: "p1", cashCollectedMinor: 0 })).toThrow(
      "this stop has cash to collect",
    );
  });

  it("takes a delivery with proof and the right money", () => {
    const after = complete(sheet(), "s1", { proofId: "p1", cashCollectedMinor: 149900 });

    expect(after.stops[0]?.state).toBe("done");
  });

  it("needs no money on a stop that has none", () => {
    expect(complete(sheet(), "s2", { proofId: "p2" }).stops[1]?.state).toBe("done");
  });

  it("needs a reason before it will record a failure", () => {
    expect(() => fail(sheet(), "s1", "")).toThrow("a failed stop needs a reason");
  });

  it("refuses to touch a stop that is not on the sheet", () => {
    expect(() => complete(sheet(), "nowhere", { proofId: "p1" })).toThrow(
      "no stop with that identifier",
    );
  });

  it("refuses to close a stop twice", () => {
    const done = complete(sheet(), "s1", { proofId: "p1", cashCollectedMinor: 149900 });

    expect(() => complete(done, "s1", { proofId: "p2" })).toThrow("that stop is already closed");
  });
});
