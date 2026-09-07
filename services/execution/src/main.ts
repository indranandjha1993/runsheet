import { Pool } from "pg";
import { migrate, ulid } from "@runsheet/runtime";
import { createRouter } from "./adapters/http.js";
import { postgresExecution } from "./adapters/repository.js";
import { describeConfig, executionConfig } from "./infra/config.js";
import { executionRoutes } from "./infra/routes.js";
import { createHttpServer, serviceLogger } from "./infra/server.js";

const config = executionConfig();
const logger = serviceLogger("execution", config.LOG_LEVEL);
const pool = new Pool({ connectionString: config.DATABASE_URL_EXECUTION });

const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
if (applied.length > 0) logger.info("migrations applied", { count: applied.length });

const router = createRouter(
  executionRoutes({
    repository: postgresExecution(pool),
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
  port: config.PORT_EXECUTION,
  probes: [
    {
      name: "database",
      check: async () => {
        await pool.query("SELECT 1");
      },
    },
  ],
});

server.listen(config.PORT_EXECUTION, () => {
  logger.info("execution service listening", describeConfig(config));
});
