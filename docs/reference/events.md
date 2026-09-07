# Every event

Generated from `contracts/events.json` by `make docs`. A service cannot publish an event that is
not in this catalogue; a test refuses it at the point of publishing.

Every event carries the same envelope: `event_id`, `tenant_id`, `aggregate_type`, `aggregate_id`,
`sequence` (the position in that aggregate's stream), `type`, `version`, `occurred_at`,
`recorded_at`, `source`, `correlation_id`, `causation_id`, and `confidence` for events that came
from a device, a connector, or a policy rather than from a person.

## Topic `address`

| Event               | Payload fields           |
| ------------------- | ------------------------ |
| `address.corrected` | none beyond the envelope |
| `address.resolved`  | none beyond the envelope |

## Topic `consignment`

| Event                              | Payload fields                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `consignment.attempted`            | `ndr_reason`, `proof_id`, `attempt_number`                                          |
| `consignment.booked`               | `order_id`, `service`, `payment_mode`, `cod_amount_minor`, `cod_currency`, `guards` |
| `consignment.cancel_requested`     | none beyond the envelope                                                            |
| `consignment.cancelled`            | none beyond the envelope                                                            |
| `consignment.damaged`              | none beyond the envelope                                                            |
| `consignment.delivered`            | none beyond the envelope                                                            |
| `consignment.departed_hub`         | none beyond the envelope                                                            |
| `consignment.found`                | none beyond the envelope                                                            |
| `consignment.hub_exception`        | `hub_id`, `consignment_id`, `reason`                                                |
| `consignment.inscanned`            | none beyond the envelope                                                            |
| `consignment.lost`                 | none beyond the envelope                                                            |
| `consignment.out_for_delivery`     | none beyond the envelope                                                            |
| `consignment.picked_up`            | none beyond the envelope                                                            |
| `consignment.pickup_attempted`     | `ndr_reason`, `proof_id`, `attempt_number`                                          |
| `consignment.rto_attempted`        | `ndr_reason`, `proof_id`, `attempt_number`                                          |
| `consignment.rto_delivered`        | none beyond the envelope                                                            |
| `consignment.rto_initiated`        | none beyond the envelope                                                            |
| `consignment.rto_out_for_delivery` | none beyond the envelope                                                            |
| `consignment.scanned_in`           | `hub_id`, `consignment_id`, `worker_id`, `weight_grams`, `volumetric_grams`         |
| `consignment.scanned_out`          | `hub_id`, `consignment_id`, `worker_id`, `run_id`                                   |

## Topic `decision`

| Event                      | Payload fields           |
| -------------------------- | ------------------------ |
| `decision.approved`        | none beyond the envelope |
| `decision.executed`        | none beyond the envelope |
| `decision.expired`         | none beyond the envelope |
| `decision.failed`          | none beyond the envelope |
| `decision.proposed`        | none beyond the envelope |
| `decision.rejected`        | none beyond the envelope |
| `decision.reversed`        | none beyond the envelope |
| `decision.shadow_recorded` | none beyond the envelope |
| `policy.dry_run_passed`    | none beyond the envelope |
| `policy.published`         | none beyond the envelope |
| `policy.retired`           | none beyond the envelope |
| `policy.rolled_back`       | none beyond the envelope |
| `policy.shadowed`          | none beyond the envelope |
| `policy.staged`            | none beyond the envelope |
| `policy.went_live`         | none beyond the envelope |

## Topic `exception`

| Event                           | Payload fields           |
| ------------------------------- | ------------------------ |
| `exception.assigned`            | none beyond the envelope |
| `exception.auto_resolved`       | none beyond the envelope |
| `exception.customer_answered`   | none beyond the envelope |
| `exception.raised`              | none beyond the envelope |
| `exception.reopened`            | none beyond the envelope |
| `exception.resolved`            | none beyond the envelope |
| `exception.sla_checked`         | none beyond the envelope |
| `exception.triaged`             | none beyond the envelope |
| `exception.waiting_on_customer` | none beyond the envelope |

## Topic `linehaul`

| Event                   | Payload fields                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| `bag.discrepancy_found` | `bag_id`, `missing_consignment_ids`, `unexpected_consignment_ids`, `misrouted` |
| `bag.emptied`           | none beyond the envelope                                                       |
| `bag.loaded`            | none beyond the envelope                                                       |
| `bag.parcel_added`      | none beyond the envelope                                                       |
| `bag.parcel_removed`    | none beyond the envelope                                                       |
| `bag.received`          | none beyond the envelope                                                       |
| `bag.seal_broken`       | `bag_id`, `seal_number`, `consignment_ids`                                     |
| `bag.sealed`            | none beyond the envelope                                                       |
| `trip.arrived`          | none beyond the envelope                                                       |
| `trip.bag_loaded`       | none beyond the envelope                                                       |
| `trip.bag_unloaded`     | none beyond the envelope                                                       |
| `trip.bags_missing`     | none beyond the envelope                                                       |
| `trip.cancelled`        | none beyond the envelope                                                       |
| `trip.closed`           | none beyond the envelope                                                       |
| `trip.crewed`           | none beyond the envelope                                                       |
| `trip.departed`         | none beyond the envelope                                                       |
| `trip.planned`          | none beyond the envelope                                                       |

## Topic `money`

| Event                         | Payload fields                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cash.collected`              | `amount_minor`, `currency`, `reference`, `driver_id`, `merchant_id`                                    |
| `cash.deposited`              | `amount_minor`, `currency`, `reference`, `driver_id`, `merchant_id`                                    |
| `cash.remitted`               | `amount_minor`, `currency`, `reference`, `driver_id`, `merchant_id`                                    |
| `cash.reversed`               | `amount_minor`, `currency`, `reference`, `driver_id`, `merchant_id`                                    |
| `cash.run_closed`             | `run_id`, `driver_id`, `currency`, `expectedMinor`, `countedMinor`, `varianceMinor`, `floatAfterMinor` |
| `cash.shortfall_found`        | `run_id`, `driver_id`, `currency`, `variance_minor`                                                    |
| `cash.surplus_found`          | `run_id`, `driver_id`, `currency`, `variance_minor`                                                    |
| `cash.written_off`            | `amount_minor`, `currency`, `reference`, `driver_id`, `merchant_id`                                    |
| `invoice.received`            | none beyond the envelope                                                                               |
| `settlement.approved`         | none beyond the envelope                                                                               |
| `settlement.dispute_rejected` | none beyond the envelope                                                                               |
| `settlement.dispute_resolved` | none beyond the envelope                                                                               |
| `settlement.disputed`         | none beyond the envelope                                                                               |
| `settlement.paid`             | none beyond the envelope                                                                               |
| `settlement.written_off`      | none beyond the envelope                                                                               |

## Topic `network`

| Event                    | Payload fields           |
| ------------------------ | ------------------------ |
| `hub.created`            | none beyond the envelope |
| `serviceability.updated` | none beyond the envelope |
| `zone.published`         | none beyond the envelope |

## Topic `order`

| Event             | Payload fields           |
| ----------------- | ------------------------ |
| `order.cancelled` | none beyond the envelope |
| `order.created`   | none beyond the envelope |

## Topic `plan`

| Event             | Payload fields           |
| ----------------- | ------------------------ |
| `plan.assignment` | none beyond the envelope |
| `plan.completed`  | none beyond the envelope |
| `plan.failed`     | none beyond the envelope |
| `plan.requested`  | none beyond the envelope |

## Topic `promise`

| Event                 | Payload fields           |
| --------------------- | ------------------------ |
| `notification.failed` | none beyond the envelope |
| `notification.sent`   | none beyond the envelope |
| `promise.updated`     | none beyond the envelope |

## Topic `run`

| Event                  | Payload fields                                        |
| ---------------------- | ----------------------------------------------------- |
| `device.synced`        | none beyond the envelope                              |
| `proof.captured`       | none beyond the envelope                              |
| `proof.media_uploaded` | none beyond the envelope                              |
| `run.action_recorded`  | none beyond the envelope                              |
| `run.assigned`         | none beyond the envelope                              |
| `run.cancelled`        | none beyond the envelope                              |
| `run.cash_counted`     | `run_id`, `amount_minor`, `currency`                  |
| `run.cash_declared`    | `run_id`, `amount_minor`, `currency`                  |
| `run.closed`           | none beyond the envelope                              |
| `run.completed`        | none beyond the envelope                              |
| `run.force_closed`     | none beyond the envelope                              |
| `run.planned`          | none beyond the envelope                              |
| `run.started`          | none beyond the envelope                              |
| `run.stop_moved`       | none beyond the envelope                              |
| `run.suspended`        | none beyond the envelope                              |
| `run.unassigned`       | none beyond the envelope                              |
| `stop.completed`       | `run_id`, `consignment_ids`, `proof_id`, `ndr_reason` |
| `stop.failed`          | `run_id`, `consignment_ids`, `proof_id`, `ndr_reason` |
| `stop.moved`           | none beyond the envelope                              |
| `stop.skipped`         | `run_id`, `consignment_ids`, `proof_id`, `ndr_reason` |
