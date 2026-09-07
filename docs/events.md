# Events

Everything that happens in the platform is an event on a topic. Services react to each other's
events; nothing reads another service's database. The full list with payloads is in the
[generated reference](reference/events.md); the machine-readable catalogue is
`contracts/events.json`.

## The envelope

Every event carries the same fields around its payload:

| Field                            | Meaning                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `event_id`                       | ULID, unique                                                 |
| `tenant_id`                      | who it belongs to                                            |
| `aggregate_type`, `aggregate_id` | the thing it is about                                        |
| `sequence`                       | its position in that thing's stream, starting at 1, no gaps  |
| `type`                           | for example `consignment.delivered`                          |
| `version`                        | the payload schema version                                   |
| `occurred_at`                    | when it happened, as best the platform knows                 |
| `recorded_at`                    | when the platform wrote it; never earlier than `occurred_at` |
| `source`                         | `api`, `device`, `connector`, `policy`, or `operator`        |
| `correlation_id`                 | shared by everything caused by the same original request     |
| `causation_id`                   | the event that directly caused this one                      |
| `confidence`                     | 0 to 1, only for `device`, `connector`, and `policy` sources |

## Topics

| Topic         | Family                                   | Keyed by                              |
| ------------- | ---------------------------------------- | ------------------------------------- |
| `consignment` | `consignment.*`                          | the consignment                       |
| `order`       | `order.*`                                | the order                             |
| `run`         | `run.*`, `stop.*`, `proof.*`, `device.*` | the run                               |
| `linehaul`    | `bag.*`, `trip.*`                        | the bag or trip                       |
| `network`     | `hub.*`, `zone.*`, `serviceability.*`    | the hub or zone                       |
| `address`     | `address.*`                              | the address                           |
| `plan`        | `plan.*`                                 | the plan                              |
| `promise`     | `promise.*`, `notification.*`            | the consignment                       |
| `exception`   | `exception.*`                            | the subject of the exception          |
| `money`       | `invoice.*`, `settlement.*`, `cash.*`    | the invoice, settlement, or reference |
| `decision`    | `policy.*`, `decision.*`                 | the policy or decision                |

## Guarantees

- **Append-only.** An event is never edited or deleted. A mistake is corrected by another event.
- **Ordered per key.** Events for one aggregate arrive in `sequence` order. Across aggregates
  there is no ordering.
- **At least once.** A consumer may see an event twice. Every consumer in the platform
  deduplicates by `event_id` and keeps a per-aggregate watermark, and yours should too.
- **Outbox.** An event is written in the same database transaction as the state change it
  describes, then relayed. There is no window in which the state changed and the event was lost.
- **Catalogued.** A service cannot publish an event that is not in the catalogue.

## Consuming from outside

Register a webhook for the events you want; each delivery is one event with its envelope and
payload, signed as described in [the interface](api.md). To replay, the append-only stream per
aggregate is available through the services that own it.

## Time and confidence

`occurred_at` on a device event is reconciled, not trusted: the handset's monotonic counter is
used where it can be, and `confidence` says how sure the platform is. A confidence under 0.6 is
never used as evidence in a service-level breach; the clock falls back to `recorded_at`.
