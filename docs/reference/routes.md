# Every route

Generated from `spec/openapi.json` by `make docs`. The specification is generated from the
schemas the services validate against, so this page cannot describe a request a service would
refuse. Paths are relative to the gateway, `http://localhost:14000` locally.

## identity

### `GET /v1/callers/current`

Report who the presented credential belongs to.

No credential needed.

| Status | Meaning                               |
| ------ | ------------------------------------- |
| 200    | the caller, its tenant and its scopes |
| 401    | no usable credential                  |

### `POST /v1/keys`

Issue an API key. The secret is shown once and never again.

No credential needed.

| Field       | Type            | Required |
| ----------- | --------------- | -------- |
| `tenant_id` | string          | yes      |
| `name`      | string          | yes      |
| `scopes`    | array of string | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the key and its secret       |
| 400    | the request did not validate |
| 404    | no such resource             |

### `POST /v1/keys/{id}/revoke`

Revoke a key at once.

No credential needed.

| Status | Meaning                      |
| ------ | ---------------------------- |
| 200    | the key is revoked           |
| 400    | the request did not validate |
| 404    | no such resource             |

### `POST /v1/tenants`

Create a tenant.

No credential needed.

| Field          | Type   | Required |
| -------------- | ------ | -------- |
| `name`         | string | yes      |
| `country_code` | string | yes      |
| `currency`     | string | yes      |
| `locale`       | string | yes      |
| `region`       | string | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the tenant                   |
| 400    | the request did not validate |

### `GET /v1/tenants/{id}`

Read a tenant.

No credential needed.

| Status | Meaning          |
| ------ | ---------------- |
| 200    | the tenant       |
| 404    | no such resource |

### `GET /v1/tenants/{id}/keys`

List a tenant's keys without their secrets.

No credential needed.

| Status | Meaning          |
| ------ | ---------------- |
| 200    | the keys         |
| 404    | no such resource |

## network

### `POST /v1/hubs`

Register a hub.

Scope: `network:write`

| Field                   | Type    | Required |
| ----------------------- | ------- | -------- |
| `code`                  | string  | yes      |
| `name`                  | string  | yes      |
| `country_code`          | string  | yes      |
| `time_zone`             | string  | yes      |
| `latitude`              | number  | yes      |
| `longitude`             | number  | yes      |
| `opens_minutes_of_day`  | integer | yes      |
| `closes_minutes_of_day` | integer | yes      |

| Status | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| 201    | the hub, with the identifier the rest of the platform uses |
| 400    | the request did not validate                               |
| 401    | no usable credential                                       |
| 403    | the key lacks the scope                                    |

### `GET /v1/serviceability`

Ask whether a point can be served.

Scope: `network:read`

| Status | Meaning                                             |
| ------ | --------------------------------------------------- |
| 200    | whether the point is serviceable, and by which zone |
| 400    | the request did not validate                        |
| 401    | no usable credential                                |

## address

### `POST /v1/addresses`

Resolve a written address to a point.

Scope: `addresses:write`

| Field          | Type   | Required |
| -------------- | ------ | -------- |
| `raw`          | string | yes      |
| `country_code` | string | yes      |

| Status | Meaning                                         |
| ------ | ----------------------------------------------- |
| 201    | the resolved address and how much it is trusted |
| 400    | the request did not validate                    |
| 401    | no usable credential                            |
| 403    | the key lacks the scope                         |

### `GET /v1/addresses/{id}`

Read a resolved address.

Scope: `addresses:read`

| Status | Meaning              |
| ------ | -------------------- |
| 200    | the address          |
| 401    | no usable credential |
| 404    | no such resource     |

### `POST /v1/addresses/{id}/confirm`

Confirm a pin a driver stood on.

Scope: `addresses:write`

| Field       | Type   | Required |
| ----------- | ------ | -------- |
| `latitude`  | number | yes      |
| `longitude` | number | yes      |
| `worker_id` | string | yes      |

| Status | Meaning                                 |
| ------ | --------------------------------------- |
| 200    | the address, with its confidence raised |
| 400    | the request did not validate            |
| 401    | no usable credential                    |
| 404    | no such resource                        |

## orders

### `POST /v1/consignments`

Book a consignment.

Scope: `consignments:write`

| Field                  | Type               | Required |
| ---------------------- | ------------------ | -------- |
| `order_reference`      | string             | yes      |
| `origin_hub_code`      | string             | yes      |
| `destination_hub_code` | string             | yes      |
| `service`              | string             | yes      |
| `payment_mode`         | `prepaid` \| `cod` | yes      |
| `proof_requirement`    | string             | yes      |
| `attempt_limit`        | integer            | yes      |
| `cod_amount_minor`     | integer            | no       |
| `cod_currency`         | string             | no       |
| `cod_tolerance_minor`  | integer            | no       |
| `packages`             | array of object    | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the consignment as booked    |
| 400    | the request did not validate |
| 401    | no usable credential         |
| 403    | the key lacks the scope      |

### `GET /v1/consignments/{id}`

Read a consignment.

Scope: `consignments:read`

| Status | Meaning              |
| ------ | -------------------- |
| 200    | the consignment      |
| 401    | no usable credential |
| 404    | no such resource     |

### `POST /v1/consignments/{id}/events`

Record what happened to a consignment.

Scope: `consignments:write`

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the consignment after the event     |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

### `POST /v1/consignments/{id}/labels`

Print labels, one per package.

Scope: `consignments:write`

| Field           | Type                                                | Required |
| --------------- | --------------------------------------------------- | -------- |
| `origin`        | object                                              | yes      |
| `destination`   | object                                              | yes      |
| `sort_code`     | string                                              | yes      |
| `service_level` | `same_day` \| `next_day` \| `standard` \| `economy` | yes      |
| `format`        | `json` \| `zpl`                                     | yes      |

| Status | Meaning                                    |
| ------ | ------------------------------------------ |
| 200    | the labels, as data or as printer commands |
| 400    | the request did not validate               |
| 401    | no usable credential                       |
| 404    | no such resource                           |

## execution

### `GET /v1/hub-scans`

List every hub scan of one parcel.

Scope: `runs:read`

| Status | Meaning                      |
| ------ | ---------------------------- |
| 200    | the scans, oldest first      |
| 400    | the request did not validate |
| 401    | no usable credential         |

### `POST /v1/hub-scans/in`

Scan a parcel into a hub.

Scope: `runs:write`

| Field                 | Type    | Required |
| --------------------- | ------- | -------- |
| `hub_id`              | string  | yes      |
| `worker_id`           | string  | yes      |
| `consignment_id`      | string  | yes      |
| `barcode`             | string  | yes      |
| `expected`            | boolean | yes      |
| `weight_grams`        | integer | no       |
| `booked_weight_grams` | integer | no       |
| `dimensions_mm`       | object  | no       |

| Status | Meaning                                |
| ------ | -------------------------------------- |
| 201    | the scan, with any exception it raised |
| 400    | the request did not validate           |
| 401    | no usable credential                   |
| 403    | the key lacks the scope                |

### `POST /v1/hub-scans/out`

Scan a parcel out to a run.

Scope: `runs:write`

| Field            | Type    | Required |
| ---------------- | ------- | -------- |
| `hub_id`         | string  | yes      |
| `worker_id`      | string  | yes      |
| `consignment_id` | string  | yes      |
| `barcode`        | string  | yes      |
| `run_id`         | string  | yes      |
| `on_run`         | boolean | yes      |

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 201    | the scan                            |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 409    | the change is not allowed from here |

### `POST /v1/proofs`

Capture proof of an attempt.

Scope: `runs:write`

| Field            | Type            | Required |
| ---------------- | --------------- | -------- |
| `consignment_id` | string          | yes      |
| `requirement`    | string          | yes      |
| `kinds`          | array of string | yes      |
| `media_ids`      | array of string | yes      |
| `geofence_ok`    | boolean         | no       |

| Status | Meaning                                             |
| ------ | --------------------------------------------------- |
| 201    | the proof, and whether it satisfies the requirement |
| 400    | the request did not validate                        |
| 401    | no usable credential                                |

### `POST /v1/runs`

Plan a run with its stops.

Scope: `runs:write`

| Field    | Type            | Required |
| -------- | --------------- | -------- |
| `hub_id` | string          | yes      |
| `date`   | string          | yes      |
| `stops`  | array of object | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the run and its stops        |
| 400    | the request did not validate |
| 401    | no usable credential         |
| 403    | the key lacks the scope      |

### `GET /v1/runs/{id}`

Read a run.

Scope: `runs:read`

| Status | Meaning              |
| ------ | -------------------- |
| 200    | the run              |
| 401    | no usable credential |
| 404    | no such resource     |

### `POST /v1/runs/{id}/actions`

Record the outcome of one stop action.

Scope: `runs:write`

| Field                  | Type                            | Required |
| ---------------------- | ------------------------------- | -------- |
| `stop_id`              | string                          | yes      |
| `action_id`            | string                          | yes      |
| `result`               | `done` \| `failed` \| `skipped` | yes      |
| `ndr_reason`           | string                          | no       |
| `proof_id`             | string                          | no       |
| `cash_collected_minor` | integer                         | no       |

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the run after the action            |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

### `POST /v1/runs/{id}/events`

Move a run through its day.

Scope: `runs:write`

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the run after the event             |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

### `POST /v1/sync/batches`

Take a shift's work off a handset in one call.

Scope: `runs:write`

| Field            | Type            | Required |
| ---------------- | --------------- | -------- |
| `device_id`      | string          | yes      |
| `device_boot_id` | string          | yes      |
| `worker_id`      | string          | yes      |
| `run_id`         | string          | yes      |
| `batch_id`       | string          | yes      |
| `clock`          | object          | yes      |
| `entries`        | array of object | yes      |

| Status | Meaning                                                           |
| ------ | ----------------------------------------------------------------- |
| 200    | what happened to each entry, and any media the server still wants |
| 400    | the request did not validate                                      |
| 401    | no usable credential                                              |
| 403    | the key lacks the scope                                           |

## linehaul

### `POST /v1/bags/parcels`

Put a parcel in the open bag for a lane.

Scope: `linehaul:write`

| Field                | Type   | Required |
| -------------------- | ------ | -------- |
| `origin_hub_id`      | string | yes      |
| `destination_hub_id` | string | yes      |
| `consignment_id`     | string | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the bag the parcel went into |
| 400    | the request did not validate |
| 401    | no usable credential         |
| 403    | the key lacks the scope      |

### `GET /v1/bags/{id}`

Read a bag.

Scope: `linehaul:read`

| Status | Meaning              |
| ------ | -------------------- |
| 200    | the bag              |
| 401    | no usable credential |
| 404    | no such resource     |

### `POST /v1/bags/{id}/events`

Receive or empty a bag.

Scope: `linehaul:write`

| Status | Meaning                                    |
| ------ | ------------------------------------------ |
| 200    | the bag, with any discrepancy it turned up |
| 400    | the request did not validate               |
| 401    | no usable credential                       |
| 404    | no such resource                           |
| 409    | the change is not allowed from here        |

### `POST /v1/bags/{id}/seal`

Seal a bag.

Scope: `linehaul:write`

| Field         | Type   | Required |
| ------------- | ------ | -------- |
| `seal_number` | string | yes      |

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the sealed bag                      |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

### `POST /v1/trips`

Plan a linehaul trip.

Scope: `linehaul:write`

| Field                | Type    | Required |
| -------------------- | ------- | -------- |
| `origin_hub_id`      | string  | yes      |
| `destination_hub_id` | string  | yes      |
| `departs_on`         | string  | yes      |
| `capacity_bags`      | integer | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the trip                     |
| 400    | the request did not validate |
| 401    | no usable credential         |
| 403    | the key lacks the scope      |

### `POST /v1/trips/{id}/bags`

Load a sealed bag onto a trip.

Scope: `linehaul:write`

| Status | Meaning                              |
| ------ | ------------------------------------ |
| 201    | the trip and the bag that went on it |
| 400    | the request did not validate         |
| 401    | no usable credential                 |
| 404    | no such resource                     |
| 409    | the change is not allowed from here  |

### `POST /v1/trips/{id}/events`

Crew, run and close a trip.

Scope: `linehaul:write`

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the trip after the event            |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

### `GET /v1/trips/{id}/manifest`

The manifest the driver hands over.

Scope: `linehaul:read`

| Status | Meaning                                |
| ------ | -------------------------------------- |
| 200    | the bags, their seals and their counts |
| 400    | the request did not validate           |
| 401    | no usable credential                   |
| 404    | no such resource                       |

## planning

### `POST /v1/plans`

Ask for a plan for a hub and a day.

Scope: `plans:write`

| Field           | Type            | Required |
| --------------- | --------------- | -------- |
| `hub_id`        | string          | yes      |
| `hub_latitude`  | number          | yes      |
| `hub_longitude` | number          | yes      |
| `date`          | string          | yes      |
| `vehicles`      | array of object | yes      |
| `jobs`          | array of object | yes      |

| Status | Meaning                                    |
| ------ | ------------------------------------------ |
| 201    | the plan, its runs, and what would not fit |
| 400    | the request did not validate               |
| 401    | no usable credential                       |

### `GET /v1/plans/{hubId}/{date}`

Read the plan for a hub and a day.

Scope: `plans:read`

| Status | Meaning              |
| ------ | -------------------- |
| 200    | the plan             |
| 401    | no usable credential |
| 404    | no such resource     |

## promise

### `GET /track/{token}`

Follow a parcel with no credential at all.

No credential needed.

| Status | Meaning                              |
| ------ | ------------------------------------ |
| 200    | what the recipient is allowed to see |
| 404    | no such resource                     |

### `POST /v1/promises`

Promise a delivery window.

Scope: `consignments:write`

| Field            | Type   | Required |
| ---------------- | ------ | -------- |
| `consignment_id` | string | yes      |
| `window_start`   | string | yes      |
| `window_end`     | string | yes      |
| `locale`         | string | yes      |

| Status | Meaning                            |
| ------ | ---------------------------------- |
| 201    | the promise and its tracking token |
| 400    | the request did not validate       |
| 401    | no usable credential               |

### `POST /v1/promises/{id}/eta`

Revise the estimate on a promise.

Scope: `consignments:write`

| Field     | Type   | Required |
| --------- | ------ | -------- |
| `eta`     | string | yes      |
| `locale`  | string | yes      |
| `channel` | string | yes      |

| Status | Meaning                        |
| ------ | ------------------------------ |
| 200    | the promise after the revision |
| 400    | the request did not validate   |
| 401    | no usable credential           |
| 404    | no such resource               |

### `POST /v1/promises/{id}/settle`

Settle a promise as kept or missed.

Scope: `consignments:write`

| Field       | Type   | Required |
| ----------- | ------ | -------- |
| `milestone` | string | yes      |
| `reason`    | string | no       |
| `locale`    | string | yes      |
| `channel`   | string | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 200    | the settled promise          |
| 400    | the request did not validate |
| 401    | no usable credential         |
| 404    | no such resource             |

## exceptions

### `GET /v1/exceptions`

List the open exceptions.

Scope: `runs:read`

| Status | Meaning                          |
| ------ | -------------------------------- |
| 200    | the open exceptions, worst first |
| 401    | no usable credential             |

### `GET /v1/exceptions/{id}`

Read an exception.

Scope: `runs:read`

| Status | Meaning              |
| ------ | -------------------- |
| 200    | the exception        |
| 401    | no usable credential |
| 404    | no such resource     |

### `POST /v1/exceptions/{id}/events`

Work an exception.

Scope: `runs:write`

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the exception after the event       |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

### `POST /v1/observations`

Report something that looks wrong.

Scope: `runs:write`

| Field          | Type   | Required |
| -------------- | ------ | -------- |
| `type`         | string | yes      |
| `aggregate_id` | string | yes      |
| `payload`      | object | yes      |

| Status | Meaning                               |
| ------ | ------------------------------------- |
| 201    | the exception, raised or already open |
| 400    | the request did not validate          |
| 401    | no usable credential                  |

## money

### `POST /v1/carrier-accounts`

Register a carrier you settle with.

Scope: `money:write`

| Field      | Type   | Required |
| ---------- | ------ | -------- |
| `name`     | string | yes      |
| `currency` | string | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the carrier account          |
| 400    | the request did not validate |
| 401    | no usable credential         |
| 403    | the key lacks the scope      |

### `GET /v1/cash/drivers/{id}/statement`

What a driver is still holding.

Scope: `money:read`

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the float and the entries behind it |
| 400    | the request did not validate        |
| 401    | no usable credential                |

### `GET /v1/cash/merchants/{id}/statement`

What a merchant is owed.

Scope: `money:read`

| Status | Meaning                               |
| ------ | ------------------------------------- |
| 200    | the payable and the entries behind it |
| 400    | the request did not validate          |
| 401    | no usable credential                  |

### `POST /v1/cash/movements`

Record cash collected, banked, paid out or written off.

Scope: `money:write`

| Field          | Type                                                                    | Required |
| -------------- | ----------------------------------------------------------------------- | -------- |
| `kind`         | `collected` \| `deposited` \| `remitted` \| `written_off` \| `reversed` | yes      |
| `amount_minor` | integer                                                                 | yes      |
| `currency`     | string                                                                  | yes      |
| `reference`    | string                                                                  | yes      |
| `driver_id`    | string                                                                  | no       |
| `merchant_id`  | string                                                                  | no       |
| `approved_by`  | string                                                                  | no       |

| Status | Meaning                                             |
| ------ | --------------------------------------------------- |
| 201    | what the driver holds and what the merchant is owed |
| 400    | the request did not validate                        |
| 401    | no usable credential                                |

### `POST /v1/cash/runs/{id}/close`

Close a run against what the driver handed in.

Scope: `money:write`

| Field           | Type    | Required |
| --------------- | ------- | -------- |
| `driver_id`     | string  | yes      |
| `currency`      | string  | yes      |
| `counted_minor` | integer | yes      |

| Status | Meaning                                    |
| ------ | ------------------------------------------ |
| 200    | the variance and what is still outstanding |
| 400    | the request did not validate               |
| 401    | no usable credential                       |
| 409    | the change is not allowed from here        |

### `POST /v1/invoices`

Take in a carrier invoice and match every line.

Scope: `money:write`

| Field                | Type            | Required |
| -------------------- | --------------- | -------- |
| `carrier_account_id` | string          | yes      |
| `number`             | string          | yes      |
| `currency`           | string          | yes      |
| `lines`              | array of object | yes      |

| Status | Meaning                               |
| ------ | ------------------------------------- |
| 201    | the invoice and how each line matched |
| 400    | the request did not validate          |
| 401    | no usable credential                  |
| 404    | no such resource                      |

### `GET /v1/invoices/{id}/settlements`

List the settlements on an invoice.

Scope: `money:read`

| Status | Meaning              |
| ------ | -------------------- |
| 200    | the settlements      |
| 401    | no usable credential |
| 404    | no such resource     |

### `POST /v1/rate-cards`

Publish a rate card.

Scope: `money:write`

| Field                | Type            | Required |
| -------------------- | --------------- | -------- |
| `carrier_account_id` | string          | yes      |
| `currency`           | string          | yes      |
| `valid_from`         | string          | yes      |
| `valid_until`        | string          | no       |
| `lanes`              | array of object | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the rate card                |
| 400    | the request did not validate |
| 401    | no usable credential         |
| 404    | no such resource             |

### `POST /v1/settlements/{id}/events`

Approve, dispute or pay a settlement.

Scope: `money:write`

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the settlement after the event      |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

## policy

### `POST /v1/decisions`

Ask a policy to decide.

Scope: `policies:write`

| Field           | Type            | Required |
| --------------- | --------------- | -------- |
| `trigger_event` | string          | yes      |
| `subject_type`  | string          | yes      |
| `subject_id`    | string          | yes      |
| `inputs`        | object          | yes      |
| `action`        | object          | yes      |
| `read_at`       | array of object | yes      |

| Status | Meaning                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------ |
| 200    | nothing decided: no policy for the trigger, the subject is outside the rollout, or the budget is spent |
| 201    | the decision it made                                                                                   |
| 400    | the request did not validate                                                                           |
| 401    | no usable credential                                                                                   |

### `POST /v1/decisions/{id}/events`

Record what happened to a decision.

Scope: `policies:write`

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the decision after the outcome      |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

### `GET /v1/decisions/{id}/replayable`

Whether the decision could be reproduced today.

Scope: `policies:read`

| Status | Meaning                                          |
| ------ | ------------------------------------------------ |
| 200    | what is present and what is missing for a replay |
| 401    | no usable credential                             |
| 404    | no such resource                                 |

### `POST /v1/policies`

Publish a policy.

Scope: `policies:write`

| Field            | Type                                                    | Required |
| ---------------- | ------------------------------------------------------- | -------- |
| `name`           | string                                                  | yes      |
| `version`        | integer                                                 | yes      |
| `code_hash`      | string                                                  | yes      |
| `autonomy`       | `act` \| `act_and_notify` \| `propose` \| `human_first` | yes      |
| `trigger_event`  | string                                                  | yes      |
| `budget_per_day` | integer                                                 | yes      |

| Status | Meaning                      |
| ------ | ---------------------------- |
| 201    | the policy                   |
| 400    | the request did not validate |
| 401    | no usable credential         |
| 403    | the key lacks the scope      |

### `GET /v1/policies/{id}/calibration`

How often the policy agreed with people.

Scope: `policies:read`

| Status | Meaning                |
| ------ | ---------------------- |
| 200    | the calibration report |
| 401    | no usable credential   |
| 404    | no such resource       |

### `POST /v1/policies/{id}/events`

Move a policy along its rollout.

Scope: `policies:write`

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | the policy after the move           |
| 400    | the request did not validate        |
| 401    | no usable credential                |
| 404    | no such resource                    |
| 409    | the change is not allowed from here |

## reporting

### `GET /v1/baselines/comparison`

Compare a measured window against a baseline window.

Scope: `reports:read`

| Status | Meaning                                                                           |
| ------ | --------------------------------------------------------------------------------- |
| 200    | both rates, the interval around the difference, and whether it is distinguishable |
| 400    | the request did not validate                                                      |
| 401    | no usable credential                                                              |
| 404    | no such resource                                                                  |

### `GET /v1/baselines/metrics`

List the metrics a value claim can be measured on.

Scope: `reports:read`

| Status | Meaning                                   |
| ------ | ----------------------------------------- |
| 200    | the metrics and which direction is better |
| 401    | no usable credential                      |

### `GET /v1/reports`

List the reports that can be run, and what each one shows.

Scope: `reports:read`

| Status | Meaning                                                 |
| ------ | ------------------------------------------------------- |
| 200    | the reports, their columns, and whether they take a hub |
| 401    | no usable credential                                    |

### `GET /v1/reports/{name}`

Run a report over a date range, as data or as a file.

Scope: `reports:read`

| Status | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| 200    | the rows, or a comma-separated file when one was asked for |
| 400    | the request did not validate                               |
| 401    | no usable credential                                       |
| 403    | the key lacks the scope                                    |
| 404    | no such resource                                           |
