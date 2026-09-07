# Connectors

A connector plugs an outside carrier into the platform. It implements one interface in
`@runsheet/connector` and nothing else: it takes data and returns data. It never touches a
database, never publishes an event, and never decides anything, so a badly behaved connector
cannot corrupt the platform.

## The contract

A connector declares a name, a semantic version, and the capabilities it has: `quote`, `book`,
`track`, `cancel`. It implements a function for each one it claims. The registry checks this
when the platform starts, so a connector that claims what it cannot do stops start-up rather
than failing in front of a customer.

Every call receives a context: the tenant, the credentials configured for that carrier, an
idempotency key, and an abort signal. Every call returns a result that is either `ok` with a
value or `failed` with a kind: `unavailable`, `rejected`, `not_found`, `throttled`, or
`misconfigured`. There are no exceptions to catch and no nulls to check.

## What the runner does for you

`runCall` wraps every call and handles what a carrier's system will do sooner or later:

- **Timeouts.** A call that has not answered in twenty seconds is aborted.
- **Retries with backoff.** An `unavailable` carrier is tried again; a `throttled` one is tried
  again after exactly the delay it asked for. A `rejected` or `misconfigured` result is not
  retried, because it will be the same next time.
- **A steady idempotency key.** Every attempt carries the same key, so a carrier that took the
  first attempt and lost the reply recognises the retry instead of booking the parcel twice.
- **Containment.** A connector that throws, hangs, or returns something that is not a result
  becomes a `failed` result the platform can act on. Whatever it threw stays inside the
  connector; it may carry credentials.

## Writing one

Copy `packages/connector/src/reference.ts`. It is a complete working carrier, small enough to
read in one sitting, with every operation, every failure kind, and idempotent booking. Its test
file shows what the platform expects of yours.

```ts
import { newRegistry, runCall, referenceCarrier } from "@runsheet/connector";

const registry = newRegistry([referenceCarrier(), yourCarrier()]);
const result = await runCall(registry.find("your-carrier"), "book", {
  context: { tenantId, credentials, idempotencyKey },
  request: { origin, destination, parcels, reference, service },
});
```
