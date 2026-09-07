import { Pool } from "pg";
import { migrate, ulid } from "@runsheet/runtime";
import { remoteLookup } from "@runsheet/auth";
import { createRouter } from "./adapters/http.js";
import { ordersEvidence } from "./adapters/orders-evidence.js";
import { postgresMoney } from "./adapters/repository.js";
import { describeConfig, moneyConfig } from "./infra/config.js";
import { moneyRoutes } from "./infra/routes.js";
import { createHttpServer, serviceLogger } from "./infra/server.js";

const config = moneyConfig();
const logger = serviceLogger("money", config.LOG_LEVEL);
const pool = new Pool({ connectionString: config.DATABASE_URL_MONEY });

const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
if (applied.length > 0) logger.info("migrations applied", { count: applied.length });

const router = createRouter(
  moneyRoutes({
    lookup: remoteLookup({ identityUrl: config.IDENTITY_URL }),
    repository: postgresMoney(pool),
    evidence: ordersEvidence({
      ordersUrl: config.ORDERS_URL,
      credential: config.SERVICE_CREDENTIAL,
    }),
    publisher: {
      publish: (event, payload, topic) => {
        logger.info("event", { type: event.type, topic, payload });
        return Promise.resolve();
      },
    },
    clock: { now: () => new Date() },
    ids: { next: () => ulid() },
    tolerance: {
      amountMinor: config.SETTLEMENT_TOLERANCE_MINOR,
      weightGrams: config.SETTLEMENT_TOLERANCE_GRAMS,
    },
    autoApproveBelowMinor: config.SETTLEMENT_AUTO_APPROVE_BELOW_MINOR,
  }),
);

const server = createHttpServer({
  router,
  logger,
  port: config.PORT_MONEY,
  probes: [
    {
      name: "database",
      check: async () => {
        await pool.query("SELECT 1");
      },
    },
  ],
});

server.listen(config.PORT_MONEY, () => {
  logger.info("money service listening", describeConfig(config));
});
