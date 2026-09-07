import { Pool } from "pg";
import { migrate, ulid } from "@runsheet/runtime";
import { remoteLookup } from "@runsheet/auth";
import { createRouter } from "./adapters/http.js";
import { postgresExceptions } from "./adapters/repository.js";
import { exceptionsConfig, describeConfig } from "./infra/config.js";
import { exceptionsRoutes } from "./infra/routes.js";
import { createHttpServer, serviceLogger } from "./infra/server.js";

const config = exceptionsConfig();
const logger = serviceLogger("exceptions", config.LOG_LEVEL);
const pool = new Pool({ connectionString: config.DATABASE_URL_EXCEPTIONS });

const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
if (applied.length > 0) logger.info("migrations applied", { count: applied.length });

const router = createRouter(
  exceptionsRoutes({
    lookup: remoteLookup({ identityUrl: config.IDENTITY_URL }),
    repository: postgresExceptions(pool),
    publisher: {
      publish: (event, payload, topic) => {
        logger.info("event", { type: event.type, topic, payload });
        return Promise.resolve();
      },
    },
    clock: { now: () => new Date() },
    ids: { next: () => ulid() },
  }),
);

const server = createHttpServer({
  router,
  logger,
  port: config.PORT_EXCEPTIONS,
  probes: [
    {
      name: "database",
      check: async () => {
        await pool.query("SELECT 1");
      },
    },
  ],
});

server.listen(config.PORT_EXCEPTIONS, () => {
  logger.info("exceptions service listening", describeConfig(config));
});
