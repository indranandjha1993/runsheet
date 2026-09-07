# Changelog

Newest first. Updated at every sprint close.

## Unreleased

### Added

Twelve services, each owning its own data and reachable through one gateway.

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
- **money** holds rate cards, matches carrier invoices four ways, works disputes, and keeps a
  cash ledger where a driver's shortfall stays owed until somebody with the authority writes it
  off.
- **linehaul** moves freight between hubs in sealed bags on trips, with a manifest the far end
  checks without opening anything, and records a misrouted bag rather than turning it away.
- **policy** decides what it is allowed to decide, records every decision so it can be replayed,
  and reports how often it agreed with the people it was shadowing.
- **reporting** answers the questions a depot manager asks each morning, as data or as a file,
  and compares a period against a baseline without calling noise an improvement.
- **gateway** puts one address in front of all of it, with per-credential rate limits and health
  that is ready only when every service is.

The field, and what reaches it:

- **A driver app** that never waits for the network. Each tap is numbered and kept, and only what
  the office explicitly settled leaves the queue, so a dropped reply costs no work. English,
  Hindi, and Arabic, the last laid out right to left with tracking numbers isolated so they
  cannot be scrambled by the words around them.
- **One sync call takes a whole shift.** It is idempotent on the command a tap minted, the device
  clock is reconciled against its monotonic counter rather than believed, and proof photographs
  are declared by hash so a delivery is never waiting on bytes.
- **The hub floor**: scan in, scan out to a run, re-weigh, and an unexpected parcel flagged rather
  than refused. Labels carry a check digit that catches a misread digit or two transposed ones.
- **A connector interface** a carrier integration implements, with timeouts, backoff, and a steady
  idempotency key handled for the author, and a working reference carrier to copy.
- **Webhooks** signed and replayed with an eight-attempt backoff spread over a day.

Two specifications ship with the repository and are generated from the same schemas the services
validate against, so neither can describe something the code would reject: every route in
`spec/openapi.json`, every event in `contracts/events.json`. A test fails when either falls behind
the code, and another fails when a service registers a route the specification does not describe.

Shared foundations: an append-only event store with a transactional outbox and an idempotent
consumer, a migration runner that refuses to run when an applied migration has been edited,
structured logging with personal data redacted, trace propagation, typed configuration that
fails at start-up naming every problem at once, and schemas for all 93 first-phase events. No
service can publish an event the catalogue does not know.

Runs from a fresh clone with three commands, and `make sandbox` hands you a tenant, a key, and
two hubs to book against. Licensed under the GNU Affero General Public License v3, with
contributions taken under the Developer Certificate of Origin.

### Notes

Pre-alpha. Every service is tested and runs, but this has never carried a real parcel.
