# Operations

How to configure, deploy, and look after a Runsheet installation.

## Configuration

Everything is an environment variable, and every one is documented in `.env.example`. A service
reads only the variables it needs, validates them at start-up, and refuses to start with a
message that names every missing or invalid variable at once, not just the first.

| Group                                | Variables                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Databases, one per service           | `DATABASE_URL_IDENTITY`, `DATABASE_URL_NETWORK`, `DATABASE_URL_ADDRESS`, `DATABASE_URL_ORDERS`, `DATABASE_URL_EXECUTION`, `DATABASE_URL_PLANNING`, `DATABASE_URL_PROMISE`, `DATABASE_URL_EXCEPTIONS`, `DATABASE_URL_MONEY`, `DATABASE_URL_POLICY`, `DATABASE_URL_LINEHAUL`, `DATABASE_URL_REPORTING` |
| Infrastructure                       | `REDIS_URL`, `BROKER_BROKERS`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`                                                                                                                                                                                                            |
| Ports, one per service               | `PORT_GATEWAY` and `PORT_<SERVICE>`                                                                                                                                                                                                                                                                  |
| Where the gateway finds each service | `IDENTITY_URL` and `<SERVICE>_URL`                                                                                                                                                                                                                                                                   |
| Public address and secrets           | `PUBLIC_BASE_URL`, `SIGNING_SECRET`, `TRACKING_LINK_TTL_HOURS`                                                                                                                                                                                                                                       |
| Service-to-service                   | `SERVICE_CREDENTIAL`                                                                                                                                                                                                                                                                                 |
| Settlement tolerances                | `SETTLEMENT_TOLERANCE_MINOR`, `SETTLEMENT_TOLERANCE_GRAMS`, `SETTLEMENT_AUTO_APPROVE_BELOW_MINOR`                                                                                                                                                                                                    |
| Gateway                              | `RATE_LIMIT_PER_MINUTE`                                                                                                                                                                                                                                                                              |
| Providers                            | `WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY`, `GEOCODER_PROVIDER`, `GEOCODER_API_KEY`, `OBJECT_STORAGE_*`                                                                                                                                                                                                 |
| Logging                              | `LOG_LEVEL`                                                                                                                                                                                                                                                                                          |

Before deploying anywhere real, change `PUBLIC_BASE_URL`, `SIGNING_SECRET`, every database
password, and `SERVICE_CREDENTIAL`. Anything whose name contains `secret`, `password`, `key`,
`token`, `url`, or `credential` is masked in the start-up log.

### The service credential

The money service asks the orders service for delivery evidence with a credential of its own.
Issue it from the identity service as a key with the single scope `consignments:read_any`, under
a tenant that exists for the platform itself, and put the secret in `SERVICE_CREDENTIAL`. The
local stack does this at start-up in `infra/local/run-all.sh`; the placeholder in `.env.example`
is never accepted by anything.

## Running the services

Each service is one Node process: `node services/<name>/dist/main.js`. It applies its own
migrations at start-up, then listens. Start identity first; everything else resolves credentials
through it. The gateway can start any time and reports ready only when everything behind it is.

Locally, `infra/local/run-all.sh` starts all of them and `infra/local/stop-all.sh` stops them.
For a deployment, run each as its own container or process with its own environment. The
services are stateless apart from their databases and can be run more than once each.

## Databases

One PostgreSQL database per service. The local stack creates them from
`infra/local/postgres/init/001-databases.sql`; create the same set in your deployment. A service
never connects to another service's database.

Migrations are plain SQL files under `services/<name>/migrations/`, applied in order at start-up
and recorded with a checksum. A migration that has been edited after it was applied stops the
service from starting rather than silently diverging. To add one, add a new numbered file; never
edit an applied one.

Back up each database on its own schedule. The event streams are append-only, so a restore loses
nothing that happened before the backup and can be replayed forward from the broker.

## Health

`GET /health` on the gateway returns `ready` with a check per service, or `degraded` naming
which is not. Each service's own `/health` checks its database. Point your orchestrator's
readiness probe at these.

## Logs

Structured JSON on standard output, one line per event, with the service name, the level, and
the `traceparent` of the request. Personal data is redacted before it is written. Set
`LOG_LEVEL` to `debug` to see every event a service publishes.

Every request through the gateway carries a `traceparent` header; a caller who quotes it lets
you find the whole path of the request across services.

## Upgrading

Pull, build, restart. Migrations apply themselves. A change that breaks an event's payload bumps
the event's `version`, and consumers keep reading the old version until they are updated; the
catalogue in `contracts/events.json` is the record of what changed.

## Continuous integration

`.github/workflows/check.yml` runs the type check, the linter, every test against a real
PostgreSQL, a coverage floor, and a check that the reference documentation matches the
specifications. Pull requests must be signed off (see `CONTRIBUTING.md`).
