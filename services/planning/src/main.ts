import { Pool } from "pg";
import { migrate, ulid } from "@runsheet/runtime";
import { remoteLookup } from "@runsheet/auth";
import { createRouter } from "./adapters/http.js";
import { nearestFirstPlanner } from "./adapters/nearest-first.js";
import { postgresPlanning } from "./adapters/repository.js";
import { describeConfig, planningConfig } from "./infra/config.js";
import { planningRoutes } from "./infra/routes.js";
import { createHttpServer, serviceLogger } from "./infra/server.js";

const config = planningConfig();
const logger = serviceLogger("planning", config.LOG_LEVEL);
const pool = new Pool({ connectionString: config.DATABASE_URL_PLANNING });

const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
if (applied.length > 0) logger.info("migrations applied", { count: applied.length });

const router = createRouter(
  planningRoutes({
    lookup: remoteLookup({ identityUrl: config.IDENTITY_URL }),
    repository: postgresPlanning(pool),
    planner: nearestFirstPlanner(),
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
  port: config.PORT_PLANNING,
  probes: [
    {
      name: "database",
      check: async () => {
        await pool.query("SELECT 1");
      },
    },
  ],
});

server.listen(config.PORT_PLANNING, () => {
  logger.info("planning service listening", describeConfig(config));
});
