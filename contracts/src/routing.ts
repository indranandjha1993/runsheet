import { topicFor } from "./events.js";

// Every service calls this before it publishes. An event the catalogue does not know never
// reaches the broker, so the published specification cannot quietly fall behind the code.
export function routingFor(type: string, expectedTopic?: string): { topic: string; key: string } {
  const routing = topicFor(type);
  if (routing === undefined) {
    throw new Error(`${type} is not in the event catalogue`);
  }
  if (expectedTopic !== undefined && expectedTopic !== routing.topic) {
    throw new Error(`${type} belongs on the ${routing.topic} topic, not ${expectedTopic}`);
  }
  return { topic: routing.topic, key: routing.key };
}
