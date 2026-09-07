# Changelog

Newest first. Updated at every sprint close.

## Unreleased

### Added

Nine services, each owning its own data and reachable through one gateway.

- **identity** issues credentials with scopes. The tenant comes from the credential and nowhere
  else; a header naming a tenant is ignored.
- **network** holds hubs, zones with priority resolution, lanes with cut-offs and operating days,
  and answers whether an address can be served and what can be promised.
- **address** parses landmarks the way people actually give directions, recognises country
  identifiers, and learns from drivers correcting the pin at the door.
- **orders** owns the consignment lifecycle, including cash on delivery enforced at the doorstep,
  partial delivery, returns, and parcels that are lost and later found.
- **execution** owns runs, stops, proof capture, and the cash day close with variance.
- **planning** packs work into vehicles by stop count, weight, and shift, and sequences each run
  through a routing port.
- **promise** holds the delivery window, messages the customer only when something changed that
  they would act on, and serves a signed expiring tracking link that carries no personal data.
- **exceptions** watches everything the network reports and raises what a person must deal with,
  once per problem however often it is replayed.
- **gateway** puts one address in front of all of it, with per-credential rate limits and health
  that is ready only when every service is.

Shared foundations: an append-only event store with a transactional outbox and an idempotent
consumer, a migration runner that refuses to run when an applied migration has been edited,
structured logging with personal data redacted, trace propagation, typed configuration that
fails at start-up naming every problem at once, and schemas for all 47 first-phase events.

Runs from a fresh clone with three commands. Licensed under the GNU Affero General Public
License v3.

### Notes

Pre-alpha. Every service is tested and runs, but this has never carried a real parcel.
