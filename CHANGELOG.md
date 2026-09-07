# Changelog

Newest first. Updated at every sprint close.

## Unreleased

### Added

- Shared kernel: event envelope with causation and correlation, sortable identifiers, money that
  always carries its currency.
- Event store: append-only stream with a database-enforced position, transactional outbox, and an
  idempotent consumer that parks out-of-order events and dead-letters what it cannot process.
- Service runtime: configuration that fails at start-up naming every problem at once, structured
  logging with trace scoping and personal-data redaction, trace propagation, health probes, and a
  migration runner that refuses to run when an applied migration has been edited.
- Contracts: schemas for all 47 first-phase events, their topic routing, and a conformance test
  proving the store and the contracts cannot drift apart.
- Network service: hubs, zones with priority resolution, lanes with cut-offs and operating days,
  and a serviceability query. Runs end to end over HTTP with health checks and migrations.
- Runs from a fresh clone: `make setup` copies the configuration, installs, starts the
  infrastructure, and migrates. Every default works unedited.
- Licensed under the GNU Affero General Public License v3.

### Notes

Pre-alpha. The foundations are built and tested; most of the product is not.
