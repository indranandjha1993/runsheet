import { describe, expect, it } from "vitest";
import { routingFor } from "./routing.js";

describe("routing an event a service is about to publish", () => {
  it("returns the topic the catalogue says the event belongs on", () => {
    expect(routingFor("run.planned").topic).toBe("run");
  });

  it("refuses an event nobody catalogued, so the specification cannot drift from the code", () => {
    expect(() => routingFor("run.teleported")).toThrow(
      "run.teleported is not in the event catalogue",
    );
  });

  it("refuses an event published onto the wrong topic", () => {
    expect(() => routingFor("run.planned", "money")).toThrow(
      "run.planned belongs on the run topic, not money",
    );
  });

  it("accepts the topic the catalogue agrees with", () => {
    expect(routingFor("cash.collected", "money").topic).toBe("money");
  });
});
