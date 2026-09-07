import { Pool } from "pg";
import { migrate, ulid } from "@runsheet/runtime";
import { remoteLookup } from "@runsheet/auth";
import { createRouter } from "./adapters/http.js";
import { postgresAddresses } from "./adapters/repository.js";
import { stubGeocoder } from "./adapters/stub-geocoder.js";
import { addressConfig, describeConfig } from "./infra/config.js";
import { addressRoutes } from "./infra/routes.js";
import { createHttpServer, serviceLogger } from "./infra/server.js";

const config = addressConfig();
const logger = serviceLogger("address", config.LOG_LEVEL);
const pool = new Pool({ connectionString: config.DATABASE_URL_ADDRESS });

const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
if (applied.length > 0) logger.info("migrations applied", { count: applied.length });

const router = createRouter(
  addressRoutes({
    lookup: remoteLookup({ identityUrl: config.IDENTITY_URL }),
    repository: postgresAddresses(pool),
    geocoder: stubGeocoder(),
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
  port: config.PORT_ADDRESS,
  probes: [
    {
      name: "database",
      check: async () => {
        await pool.query("SELECT 1");
      },
    },
  ],
});

server.listen(config.PORT_ADDRESS, () => {
  logger.info("address service listening", describeConfig(config));
});
