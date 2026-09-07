# Runsheet

Runsheet is an open-source execution platform for logistics networks. It plans the day's work,
runs it in the field, closes the money, and keeps a replayable record of every automated decision
it makes.

The name is the driver's runsheet: the list of work a courier executes and closes out. In
Runsheet every unit of work is one of those, whether it is a delivery run, a linehaul trip, a
settlement batch, or a dispute.

Clone it, run it, deploy it wherever you like. Nothing here assumes a hosted address.

## Status

Pre-alpha. The domain model and architecture are settled and the shared foundations are built and
tested. The first services are being written. It does not yet do useful work.

## Run it

You need Docker, Node 24 or later, and pnpm.

```sh
git clone <your clone url> runsheet
cd runsheet
make setup
```

That copies `.env.example` to `.env`, installs dependencies, starts the infrastructure, and
applies migrations. Then:

```sh
make check    # tests, type check, linter
make help     # everything else
```

The defaults in `.env.example` work as they are, so a fresh clone runs without editing anything.
Every setting, including every port, lives there. Change `PUBLIC_BASE_URL` and `SIGNING_SECRET`
before you deploy anywhere real.

Ports are deliberately unusual, in the 13000 to 19999 range, so the stack does not collide with
whatever else you have running.

## Principles

- Act, do not watch. Dashboards are not the product; closed loops are.
- Every automated decision can be replayed, simulated before rollout, and rolled back.
- Live in days. Setup and integration time is treated as a defect.
- Open all the way down: the whole execution layer is inspectable and self-hostable.
- Built for the field: offline-first, low bandwidth, imperfect addresses, cash on delivery.

## Layout

| Path                  | What is in it                                                         |
| --------------------- | --------------------------------------------------------------------- |
| `packages/kernel`     | Event envelope, identifiers, money                                    |
| `packages/eventstore` | Append-only event stream, transactional outbox, idempotent consumer   |
| `packages/runtime`    | Configuration, logging, tracing, health, migrations                   |
| `contracts`           | Event schemas and topic routing, the source of truth between services |
| `services/*`          | One service per bounded context, each hexagonal inside                |
| `infra/local`         | The local stack: database, cache, broker, analytics                   |

## Contributing

See `CONTRIBUTING.md`. Changes are small, test-first, and merged from a branch per change.

## Licence

Not yet chosen. Until a licence file exists, all rights are reserved.
