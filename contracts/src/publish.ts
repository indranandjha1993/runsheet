import { writeFileSync } from "node:fs";
import { asyncApiDocument } from "./asyncapi.js";

// Written to disk so the specification ships with the repository and anyone can generate a
// client from it without running anything.
export function publishTo(path: string, version: string): void {
  writeFileSync(path, `${JSON.stringify(asyncApiDocument(version), null, 2)}\n`);
}
