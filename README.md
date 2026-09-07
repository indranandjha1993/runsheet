# Runsheet

Runsheet is an execution platform for logistics networks. It plans the day's work, runs it in
the field, closes the money, and keeps a replayable record of every automated decision it makes.

The name is the driver's runsheet: the list of work a courier executes and closes out. In
Runsheet every unit of work is one of those, whether it is a delivery run, a linehaul trip, a
settlement batch, or a dispute.

## Status

Pre-alpha. The domain model and service architecture are settled; the first services are being
built test-first. Nothing here is ready to run yet.

## Principles

- Act, do not watch. Dashboards are not the product; closed loops are.
- Every automated decision can be replayed, simulated before rollout, and rolled back.
- Live in days. Setup and integration time is treated as a defect.
- Open by default: a public, versioned API and event stream for the whole domain.
- Built for the field: offline-first, low bandwidth, imperfect addresses.

## Layout

Services live under `services/`, one per bounded context, each with a hexagonal layout
(`domain`, `application`, `adapters`, `infra`). Shared schemas live under `contracts/`. The
layout fills in as services land; see `CONTRIBUTING.md` for the conventions.

## Contributing

See `CONTRIBUTING.md`. Changes are small, test-first, and merged from a branch per change.
