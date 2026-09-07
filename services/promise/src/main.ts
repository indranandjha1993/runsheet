import { Pool } from "pg";
import { migrate, ulid } from "@runsheet/runtime";
import { remoteLookup } from "@runsheet/auth";
import { createRouter } from "./adapters/http.js";
import { postgresPromises } from "./adapters/repository.js";
import { loggingMessenger } from "./adapters/logging-messenger.js";
import { describeConfig, promiseConfig } from "./infra/config.js";
import { promiseRoutes } from "./infra/routes.js";
import { createHttpServer, serviceLogger } from "./infra/server.js";

const config = promiseConfig();
const logger = serviceLogger("promise", config.LOG_LEVEL);
const pool = new Pool({ connectionString: config.DATABASE_URL_PROMISE });

const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
if (applied.length > 0) logger.info("migrations applied", { count: applied.length });

const router = createRouter(
  promiseRoutes({
    lookup: remoteLookup({ identityUrl: config.IDENTITY_URL }),
    repository: postgresPromises(pool),
    messenger: loggingMessenger(logger),
    publisher: {
      publish: (event, payload, topic) => {
        logger.info("event", { type: event.type, topic, payload });
        return Promise.resolve();
      },
    },
    clock: { now: () => new Date() },
    ids: { next: () => ulid() },
    signingSecret: config.SIGNING_SECRET,
    trackingValidHours: config.TRACKING_LINK_TTL_HOURS,
  }),
);

const server = createHttpServer({
  router,
  logger,
  port: config.PORT_PROMISE,
  probes: [
    {
      name: "database",
      check: async () => {
        await pool.query("SELECT 1");
      },
    },
  ],
});

server.listen(config.PORT_PROMISE, () => {
  logger.info("promise service listening", describeConfig(config));
});
