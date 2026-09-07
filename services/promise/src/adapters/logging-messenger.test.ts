import { describe, expect, it } from "vitest";
import { createLogger } from "@runsheet/runtime";
import { loggingMessenger } from "./logging-messenger.js";

describe("the messenger used when none is configured", () => {
  it("writes the message where an operator can read it", async () => {
    const lines: string[] = [];
    const logger = createLogger({ service: "promise", write: (line) => lines.push(line) });

    await loggingMessenger(logger).send({
      channel: "whatsapp",
      text: "Your parcel is on its way.",
      locale: "en-IN",
    });

    expect(lines[0]).toContain("Your parcel is on its way.");
    expect(lines[0]).toContain("whatsapp");
  });
});
