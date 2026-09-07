import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openApiDocument } from "@runsheet/api";
import { SURFACES } from "./surfaces.js";

const shape = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string(), version: z.string() }),
  components: z.record(z.string(), z.unknown()),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});

const onDisk = (): z.infer<typeof shape> =>
  shape.parse(JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")));

describe("the interface specification that ships with the repository", () => {
  it("matches what the code would generate today", () => {
    // If this fails, a route changed and nobody regenerated. Run the spec generate script and
    // commit the result.
    expect(onDisk()).toEqual(shape.parse(openApiDocument(SURFACES, "0.1.0")));
  });

  it("declares a bearer credential rather than a tenant header", () => {
    const schemes = onDisk().components["securitySchemes"];

    expect(JSON.stringify(schemes)).toContain("bearer");
    expect(JSON.stringify(onDisk().paths)).not.toContain("x-tenant-id");
  });

  it("writes path parameters the way the specification format wants them", () => {
    const paths = Object.keys(onDisk().paths);

    expect(paths.some((path) => path.includes("{id}"))).toBe(true);
    expect(paths.some((path) => path.includes(":"))).toBe(false);
  });

  it("is complete enough to build against without asking us", () => {
    const document = onDisk();

    expect(Object.keys(document.paths).length).toBeGreaterThan(50);
    expect(JSON.stringify(document)).toContain("consignment");
  });
});
