import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { remoteLookup } from "@runsheet/auth";
import { createRouter } from "./adapters/http.js";
import { postgresReporting } from "./adapters/repository.js";
import { describeConfig, reportingConfig } from "./infra/config.js";
import { reportingRoutes } from "./infra/routes.js";
import { createHttpServer, serviceLogger } from "./infra/server.js";

const config = reportingConfig();
const logger = serviceLogger("reporting", config.LOG_LEVEL);
const pool = new Pool({ connectionString: config.DATABASE_URL_REPORTING });

const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
if (applied.length > 0) logger.info("migrations applied", { count: applied.length });

const router = createRouter(
  reportingRoutes({
    lookup: remoteLookup({ identityUrl: config.IDENTITY_URL }),
    repository: postgresReporting(pool),
    clock: { now: () => new Date() },
  }),
);

const server = createHttpServer({
  router,
  logger,
  port: config.PORT_REPORTING,
  probes: [
    {
      name: "database",
      check: async () => {
        await pool.query("SELECT 1");
      },
    },
  ],
});

server.listen(config.PORT_REPORTING, () => {
  logger.info("reporting service listening", describeConfig(config));
});
