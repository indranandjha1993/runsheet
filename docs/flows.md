# Business flows

The life of one parcel, with the service and the call at each step. `infra/local/walkthrough.sh`
runs all of this and asserts every step; it is the fastest way to see the platform work.

Every request goes through the gateway on port 14000 with `Authorization: Bearer <key>`.

## 1. Set up an operator

| Step                    | Service  | Call               |
| ----------------------- | -------- | ------------------ |
| Create the tenant       | identity | `POST /v1/tenants` |
| Issue a key with scopes | identity | `POST /v1/keys`    |
| Register hubs           | network  | `POST /v1/hubs`    |

A key is shown once. Scopes are `resource:read` or `resource:write`; write implies read. The
[interface page](api.md) lists them.

## 2. Book

| Step                           | Service | Call                                |
| ------------------------------ | ------- | ----------------------------------- |
| Resolve the customer's address | address | `POST /v1/addresses`                |
| Book the consignment           | orders  | `POST /v1/consignments`             |
| Print labels                   | orders  | `POST /v1/consignments/{id}/labels` |
| Promise a window               | promise | `POST /v1/promises`                 |

The booking names its origin and destination hubs; without a lane it could not be priced or
planned. Cash on delivery needs an amount and a currency at booking, and the delivery guard
enforces them at the door. Labels come back as data or, with `format: zpl`, as commands a
thermal printer takes directly.

The promise returns a tracking token. `GET /track/{token}` opens with no credential and shows
the customer only what they are entitled to see.

## 3. Through the origin hub

| Step              | Service   | Call                      |
| ----------------- | --------- | ------------------------- |
| Scan in, re-weigh | execution | `POST /v1/hub-scans/in`   |
| Put in a bag      | linehaul  | `POST /v1/bags/parcels`   |
| Seal the bag      | linehaul  | `POST /v1/bags/{id}/seal` |

A scan carrying a weight that differs from the booking by more than the allowance raises a
`weight_differs_from_booking` exception on the scan. An unexpected parcel is accepted and
flagged. A barcode with a wrong check digit is refused.

A hub keeps one open bag per destination; putting a parcel in opens one if none is open.

## 4. The middle mile

| Step              | Service  | Call                                               |
| ----------------- | -------- | -------------------------------------------------- |
| Plan the trip     | linehaul | `POST /v1/trips`                                   |
| Crew it           | linehaul | `POST /v1/trips/{id}/events` `crewed`              |
| Load the bag      | linehaul | `POST /v1/trips/{id}/bags`                         |
| Take the manifest | linehaul | `GET /v1/trips/{id}/manifest`                      |
| Depart, arrive    | linehaul | `POST /v1/trips/{id}/events` `departed`, `arrived` |
| Receive the bag   | linehaul | `POST /v1/bags/{id}/events` `received`             |
| Empty it          | linehaul | `POST /v1/bags/{id}/events` `emptied`              |
| Close the trip    | linehaul | `POST /v1/trips/{id}/events` `closed`              |

Only a sealed bag can be loaded, and a trip cannot depart empty or uncrewed. A bag received at
the wrong hub is recorded as misrouted rather than turned away. Emptying a bag names every
parcel that was expected and did not come out, and every parcel that came out unexpectedly; a
broken seal raises an exception even when the count is right. Closing a trip names the bags that
never came off.

## 5. The last mile

| Step                    | Service   | Call                                              |
| ----------------------- | --------- | ------------------------------------------------- |
| Pack the day            | planning  | `POST /v1/plans`                                  |
| Create the run          | execution | `POST /v1/runs`                                   |
| Scan out to the run     | execution | `POST /v1/hub-scans/out`                          |
| Assign and start        | execution | `POST /v1/runs/{id}/events` `assigned`, `started` |
| Sync the driver's shift | execution | `POST /v1/sync/batches`                           |
| Capture proof           | execution | `POST /v1/proofs`                                 |
| Record the delivery     | orders    | `POST /v1/consignments/{id}/events` `delivered`   |

A scan out for a parcel that is not on the run is refused, because loading it is how parcels go
missing. The sync batch is idempotent on each entry's command identifier: the same shift sent
twice is recorded once, and the response says `duplicate` for what it already had. Proof media
is declared by hash and uploaded separately, so a photograph backlog delays nothing.

The `delivered` event needs a proof, and for cash on delivery the amount collected. The platform
stamps the delivery time itself; nothing the caller sends is trusted for it.

## 6. The money

| Step                                 | Service | Call                                               |
| ------------------------------------ | ------- | -------------------------------------------------- |
| Record the cash collected            | money   | `POST /v1/cash/movements` `collected`              |
| Close the driver's day               | money   | `POST /v1/cash/runs/{id}/close`                    |
| Write off a shortfall, with approval | money   | `POST /v1/cash/movements` `written_off`            |
| A driver's statement                 | money   | `GET /v1/cash/drivers/{id}/statement`              |
| Register the carrier and its rates   | money   | `POST /v1/carrier-accounts`, `POST /v1/rate-cards` |
| Take in the carrier's invoice        | money   | `POST /v1/invoices`                                |
| Work a settlement                    | money   | `POST /v1/settlements/{id}/events`                 |

Closing a run banks what the driver handed in against what they collected. A shortfall stays on
the driver until somebody approves the write-off; a write-off with no approver is refused. The
merchant is owed the full collection regardless.

Each invoice line is matched against the order, the rate card, the delivery evidence, and the
billed amount. The money service fetches the evidence from the orders service itself, with its
own credential; it never reads another service's database. Lines within tolerance settle
automatically when below the auto-approve limit.

## 7. When something goes wrong

| Step                  | Service    | Call                              |
| --------------------- | ---------- | --------------------------------- |
| Report an observation | exceptions | `POST /v1/observations`           |
| Work an exception     | exceptions | `POST /v1/exceptions/{id}/events` |
| The queue             | exceptions | `GET /v1/exceptions`              |

An observation is an event the network saw. The rules decide whether it is an exception: a run
closed with a cash variance, a failed attempt, a lost or damaged parcel, an address resolved
with low confidence. The same problem on the same subject is raised once; a second report
returns the open exception.

## 8. Automating with evidence

| Step                               | Service | Call                                                                                |
| ---------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| Publish a policy                   | policy  | `POST /v1/policies`                                                                 |
| Walk it out                        | policy  | `POST /v1/policies/{id}/events` `dry_run_passed`, `shadowed`, `staged`, `went_live` |
| Ask it to decide                   | policy  | `POST /v1/decisions`                                                                |
| Record what happened               | policy  | `POST /v1/decisions/{id}/events`                                                    |
| Could it be replayed?              | policy  | `GET /v1/decisions/{id}/replayable`                                                 |
| How well did it agree with people? | policy  | `GET /v1/policies/{id}/calibration`                                                 |

A policy cannot go live without passing a dry run and a shadow period in which it agreed with
people often enough. Staged rollout applies to a stable percentage of subjects. Every decision
records what it read and where, so it can be replayed on the same inputs.

## 9. Looking back

| Step               | Service   | Call                                                             |
| ------------------ | --------- | ---------------------------------------------------------------- |
| The reports        | reporting | `GET /v1/reports`, `GET /v1/reports/{name}?from=&to=&format=csv` |
| Against a baseline | reporting | `GET /v1/baselines/comparison?metric=&baseline_from=&...`        |

See [reporting](reporting.md).
