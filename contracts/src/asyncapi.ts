import { z } from "zod";
import { envelopeSchema } from "./envelope.js";
import { eventCatalogue } from "./events.js";

export interface Channel {
  readonly topic: string;
  readonly key: string;
  readonly payload: Record<string, unknown>;
}

export interface AsyncApiDocument {
  readonly asyncapi: "3.0.0";
  readonly info: { readonly title: string; readonly version: string };
  readonly envelope: Record<string, unknown>;
  readonly channels: Record<string, Channel>;
}

function shapeOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

// Generated from the same schemas the services validate against, so the published document
// cannot describe something the code does not do.
export function asyncApiDocument(version: string): AsyncApiDocument {
  const channels: Record<string, Channel> = {};

  for (const [type, definition] of Object.entries(eventCatalogue)) {
    channels[type] = {
      topic: definition.routing.topic,
      key: definition.routing.key,
      payload: shapeOf(definition.payload),
    };
  }

  return {
    asyncapi: "3.0.0",
    info: { title: "Runsheet events", version },
    envelope: shapeOf(envelopeSchema),
    channels,
  };
}
