import { writeFileSync } from "node:fs";
import { openApiDocument } from "@runsheet/api";
import { SURFACES } from "./surfaces.js";

export function publishTo(path: string, version: string): void {
  writeFileSync(path, `${JSON.stringify(openApiDocument(SURFACES, version), null, 2)}\n`);
}
