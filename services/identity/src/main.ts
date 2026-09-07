import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { migrate, ulid } from "@runsheet/runtime";
import { createRouter } from "./adapters/http.js";
import { postgresIdentity } from "./adapters/repository.js";
import { describeConfig, identityConfig } from "./infra/config.js";
import { identityRoutes } from "./infra/routes.js";
import { createHttpServer, serviceLogger } from "./infra/server.js";

const config = identityConfig();
const logger = serviceLogger("identity", config.LOG_LEVEL);
const pool = new Pool({ connectionString: config.DATABASE_URL_IDENTITY });

const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
if (applied.length > 0) logger.info("migrations applied", { count: applied.length });

const router = createRouter(
  identityRoutes({
    repository: postgresIdentity(pool),
    clock: { now: () => new Date() },
    ids: { next: () => ulid() },
    secrets: { next: () => randomBytes(24).toString("hex") },
  }),
);

const server = createHttpServer({
  router,
  logger,
  port: config.PORT_IDENTITY,
  probes: [
    {
      name: "database",
      check: async () => {
        await pool.query("SELECT 1");
      },
    },
  ],
});

server.listen(config.PORT_IDENTITY, () => {
  logger.info("identity service listening", describeConfig(config));
});
