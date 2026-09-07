import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { asyncApiDocument } from "./asyncapi.js";

const published = new URL("../events.json", import.meta.url).pathname;

// Validated rather than asserted, so a malformed file fails here with a readable message instead
// of somewhere further down.
const shape = z.object({
  channels: z.record(z.string(), z.unknown()),
  envelope: z.object({ properties: z.record(z.string(), z.unknown()) }),
});

function onDisk(): z.infer<typeof shape> {
  return shape.parse(JSON.parse(readFileSync(published, "utf8")));
}

describe("the specification that ships with the repository", () => {
  it("matches what the code would generate today", () => {
    // If this fails, the schemas changed and nobody regenerated. Run the contracts generate
    // script and commit the result.
    expect(onDisk()).toEqual(shape.parse(asyncApiDocument("0.1.0")));
  });

  it("is complete enough for someone to build against without asking us", () => {
    const document = onDisk();

    expect(Object.keys(document.channels).length).toBeGreaterThan(40);
    expect(Object.keys(document.envelope.properties)).toContain("causation_id");
  });
});
