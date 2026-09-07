import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";

describe("writing a table as csv", () => {
  it("puts the column names on the first line", () => {
    const csv = toCsv(["hub", "delivered"], [{ hub: "BLR1", delivered: 42 }]);

    expect(csv.split("\n")[0]).toBe("hub,delivered");
  });

  it("writes the rows in the order the columns were asked for", () => {
    const csv = toCsv(["delivered", "hub"], [{ hub: "BLR1", delivered: 42 }]);

    expect(csv.split("\n")[1]).toBe("42,BLR1");
  });

  it("quotes a value with a comma in it, so the columns still line up", () => {
    const csv = toCsv(["name"], [{ name: "Sharma, Aarav" }]);

    expect(csv.split("\n")[1]).toBe('"Sharma, Aarav"');
  });

  it("doubles a quote inside a value, which is how csv escapes one", () => {
    const csv = toCsv(["name"], [{ name: 'The "Blue" Hub' }]);

    expect(csv.split("\n")[1]).toBe('"The ""Blue"" Hub"');
  });

  it("quotes a value with a newline rather than breaking the row", () => {
    const csv = toCsv(["note"], [{ note: "line one\nline two" }]);

    expect(csv).toContain('"line one\nline two"');
    expect(csv.split("\n")).toHaveLength(4);
  });

  it("writes an absent value as nothing at all, not as the word undefined", () => {
    const csv = toCsv(["hub", "note"], [{ hub: "BLR1" }]);

    expect(csv.split("\n")[1]).toBe("BLR1,");
  });

  it("writes a date as the moment it was, in a form every tool reads", () => {
    const csv = toCsv(["at"], [{ at: new Date("2026-09-07T10:00:00.000Z") }]);

    expect(csv.split("\n")[1]).toBe("2026-09-07T10:00:00.000Z");
  });

  it("defuses a value a spreadsheet would run as a formula", () => {
    const csv = toCsv(["name"], [{ name: "=SUM(A1:A9)" }]);

    expect(csv.split("\n")[1]).toBe("'=SUM(A1:A9)");
  });

  it("defuses every character a spreadsheet treats as the start of a formula", () => {
    const csv = toCsv(["a", "b", "c", "d"], [{ a: "+1", b: "-1", c: "@x", d: "\tx" }]);

    expect(csv.split("\n")[1]).toBe("'+1,'-1,'@x,'\tx");
  });

  it("writes just the header when there is nothing to report", () => {
    expect(toCsv(["hub"], [])).toBe("hub\n");
  });

  it("ends with a newline, because a file that does not upsets other tools", () => {
    expect(toCsv(["hub"], [{ hub: "BLR1" }]).endsWith("\n")).toBe(true);
  });
});
