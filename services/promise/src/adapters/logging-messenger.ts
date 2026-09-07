import type { Logger } from "@runsheet/runtime";
import type { Messenger } from "../application/ports.js";

// Used when no messaging provider is configured, so a fresh clone runs without an account
// anywhere. The message is logged rather than sent, and the notification record still says it
// was sent, because from the system's point of view it was handed to the configured channel.
export function loggingMessenger(logger: Logger): Messenger {
  return {
    send: (to) => {
      logger.info("message", { channel: to.channel, locale: to.locale, text: to.text });
      return Promise.resolve();
    },
  };
}
