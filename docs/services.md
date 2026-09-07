# The services

Twelve services, one per bounded context. Each owns its own database, exposes its routes behind
the gateway, publishes events other services react to, and never reads another service's
tables. Inside every service the layout is the same: `domain/` holds the rules as pure functions,
`application/` the use cases and ports, `adapters/` the database and outside calls, `infra/`
the configuration, routes, and server.

Full request and response details for every route are in [the generated reference](reference/routes.md).

## identity: Tenants and credentials

_Who is calling, and for whom._ Local port 14200.

Every other service asks identity to resolve a bearer key into a tenant and a set of scopes. A
key's secret is shown once when issued and stored only as a hash. Revocation takes effect at
once because resolutions are cached for thirty seconds at most. A key may carry
`consignments:read_any`, which lets a platform service ask about any tenant on that tenant's
behalf; nothing else can name a tenant.

| Route                       | What it does                                               |
| --------------------------- | ---------------------------------------------------------- |
| `GET /v1/callers/current`   | Report who the presented credential belongs to             |
| `GET /v1/tenants/{id}/keys` | List a tenant's keys without their secrets                 |
| `GET /v1/tenants/{id}`      | Read a tenant                                              |
| `POST /v1/keys/{id}/revoke` | Revoke a key at once                                       |
| `POST /v1/keys`             | Issue an API key. The secret is shown once and never again |
| `POST /v1/tenants`          | Create a tenant                                            |

## network: Hubs, zones, lanes, serviceability

_The shape of the operator's network._ Local port 14210.

Hubs have codes, time zones, and opening hours. Zones resolve a point to the hub that serves it
with priority when zones overlap. Serviceability answers whether a point can be served and what
can be promised there.

| Route                    | What it does                      |
| ------------------------ | --------------------------------- |
| `GET /v1/serviceability` | Ask whether a point can be served |
| `POST /v1/hubs`          | Register a hub                    |

## address: Address resolution

_Turning what a customer wrote into a place the network can reach._ Local port 14215.

The parser recognises units, landmarks, and postcodes the way people write them, and country
identifiers where they exist. Confidence starts with the geocoder and rises every time a driver
confirms the pin at the door; a confirmation from the field always outranks a geocoder.

| Route                             | What it does                         |
| --------------------------------- | ------------------------------------ |
| `GET /v1/addresses/{id}`          | Read a resolved address              |
| `POST /v1/addresses/{id}/confirm` | Confirm a pin a driver stood on      |
| `POST /v1/addresses`              | Resolve a written address to a point |

## orders: Orders, consignments, labels

_The consignment lifecycle._ Local port 14220.

The consignment is the aggregate: booked with its guards, its lane, and its packages, moved by
events through a fixed state machine, and never set from outside. Cash on delivery is enforced at
the doorstep. Labels carry a check-digit barcode; serials are reserved in a block per
consignment so a reprint gives the same barcodes.

| Route                               | What it does                          |
| ----------------------------------- | ------------------------------------- |
| `GET /v1/consignments/{id}`         | Read a consignment                    |
| `POST /v1/consignments/{id}/events` | Record what happened to a consignment |
| `POST /v1/consignments/{id}/labels` | Print labels, one per package         |
| `POST /v1/consignments`             | Book a consignment                    |

## execution: Runs, stops, proofs, hub scans, device sync

_The field._ Local port 14230.

A run is a driver's day. Proofs are declared by hash before their bytes arrive. Hub scans move
parcels in and out with re-weighing. The sync endpoint takes a whole shift from a handset in one
call, idempotent on each tap's command identifier, and reconciles the device clock against its
monotonic counter rather than believing it.

| Route                        | What it does                                  |
| ---------------------------- | --------------------------------------------- |
| `GET /v1/hub-scans`          | List every hub scan of one parcel             |
| `GET /v1/runs/{id}`          | Read a run                                    |
| `POST /v1/hub-scans/in`      | Scan a parcel into a hub                      |
| `POST /v1/hub-scans/out`     | Scan a parcel out to a run                    |
| `POST /v1/proofs`            | Capture proof of an attempt                   |
| `POST /v1/runs/{id}/actions` | Record the outcome of one stop action         |
| `POST /v1/runs/{id}/events`  | Move a run through its day                    |
| `POST /v1/runs`              | Plan a run with its stops                     |
| `POST /v1/sync/batches`      | Take a shift's work off a handset in one call |

## linehaul: Bags, trips, manifests

_The middle mile._ Local port 14235.

Bags are sealed containers of parcels between hubs; trips are vehicles running bags on a lane.
The manifest carries seals and counts so the far end checks a load without opening it. A bag at
the wrong hub or a trip diverted to the wrong city is recorded, never refused, because the
freight is where it is and somebody has to be able to find it.

| Route                         | What it does                            |
| ----------------------------- | --------------------------------------- |
| `GET /v1/bags/{id}`           | Read a bag                              |
| `GET /v1/trips/{id}/manifest` | The manifest the driver hands over      |
| `POST /v1/bags/parcels`       | Put a parcel in the open bag for a lane |
| `POST /v1/bags/{id}/events`   | Receive or empty a bag                  |
| `POST /v1/bags/{id}/seal`     | Seal a bag                              |
| `POST /v1/trips/{id}/bags`    | Load a sealed bag onto a trip           |
| `POST /v1/trips/{id}/events`  | Crew, run and close a trip              |
| `POST /v1/trips`              | Plan a linehaul trip                    |

## planning: Capacity and sequencing

_Packing the day into vehicles._ Local port 14240.

Jobs are packed into vehicles by stop count, weight, and shift length, nearest first, so what
does not fit is the far outlier rather than whichever job came first. Each run is sequenced
through a routing port that a real solver can replace.

| Route                          | What it does                       |
| ------------------------------ | ---------------------------------- |
| `GET /v1/plans/{hubId}/{date}` | Read the plan for a hub and a day  |
| `POST /v1/plans`               | Ask for a plan for a hub and a day |

## promise: Delivery windows, tracking, notifications

_What the customer was told._ Local port 14250.

A promise is a window and a tracking token. The public tracking page opens with no credential
and carries no personal data. Notifications go out only when something changed that the customer
would act on, in the customer's language.

| Route                           | What it does                              |
| ------------------------------- | ----------------------------------------- |
| `GET /track/{token}`            | Follow a parcel with no credential at all |
| `POST /v1/promises/{id}/eta`    | Revise the estimate on a promise          |
| `POST /v1/promises/{id}/settle` | Settle a promise as kept or missed        |
| `POST /v1/promises`             | Promise a delivery window                 |

## exceptions: Observations, exceptions, service-level clocks

_What a person must deal with._ Local port 14260.

Observations are events the network saw; rules decide which become exceptions. Each exception
has a severity and an allowance, and is raised once per problem however often it is reported.
Working one moves it through triage, assignment, waiting on the customer, and resolution.

| Route                             | What it does                      |
| --------------------------------- | --------------------------------- |
| `GET /v1/exceptions/{id}`         | Read an exception                 |
| `GET /v1/exceptions`              | List the open exceptions          |
| `POST /v1/exceptions/{id}/events` | Work an exception                 |
| `POST /v1/observations`           | Report something that looks wrong |

## money: Rate cards, invoices, settlements, the cash ledger

_Closing the money._ Local port 14270.

Carrier invoices are matched four ways per line against the order, the rate card, the delivery
evidence fetched from the orders service, and the billed amount. The cash ledger is append-only
with two accounts, driver float and merchant payable; a shortfall stays on the driver until a
named approver writes it off.

| Route                                   | What it does                                           |
| --------------------------------------- | ------------------------------------------------------ |
| `GET /v1/cash/drivers/{id}/statement`   | What a driver is still holding                         |
| `GET /v1/cash/merchants/{id}/statement` | What a merchant is owed                                |
| `GET /v1/invoices/{id}/settlements`     | List the settlements on an invoice                     |
| `POST /v1/carrier-accounts`             | Register a carrier you settle with                     |
| `POST /v1/cash/movements`               | Record cash collected, banked, paid out or written off |
| `POST /v1/cash/runs/{id}/close`         | Close a run against what the driver handed in          |
| `POST /v1/invoices`                     | Take in a carrier invoice and match every line         |
| `POST /v1/rate-cards`                   | Publish a rate card                                    |
| `POST /v1/settlements/{id}/events`      | Approve, dispute or pay a settlement                   |

## policy: Policies, decisions, calibration

_Automation that can be trusted._ Local port 14280.

A policy walks from draft through dry run, shadow, and staged rollout to live, with a daily
budget and a rollback from anywhere. Every decision records its inputs, the policy version and
code hash, the stream positions it read, and any model exchange, so it can be replayed.
Calibration reports how often it agreed with people.

| Route                               | What it does                                   |
| ----------------------------------- | ---------------------------------------------- |
| `GET /v1/decisions/{id}/replayable` | Whether the decision could be reproduced today |
| `GET /v1/policies/{id}/calibration` | How often the policy agreed with people        |
| `POST /v1/decisions/{id}/events`    | Record what happened to a decision             |
| `POST /v1/decisions`                | Ask a policy to decide                         |
| `POST /v1/policies/{id}/events`     | Move a policy along its rollout                |
| `POST /v1/policies`                 | Publish a policy                               |

## reporting: Operational reports and baselines

_Looking back honestly._ Local port 14290.

Six named reports over narrow projections, as data or as a spreadsheet-safe file. The consumers
that fill the projections from the event streams are not built yet. Baseline
comparison reports an interval around every difference and refuses to call anything an
improvement when that interval includes no change.

| Route                          | What it does                                              |
| ------------------------------ | --------------------------------------------------------- |
| `GET /v1/baselines/comparison` | Compare a measured window against a baseline window       |
| `GET /v1/baselines/metrics`    | List the metrics a value claim can be measured on         |
| `GET /v1/reports/{name}`       | Run a report over a date range, as data or as a file      |
| `GET /v1/reports`              | List the reports that can be run, and what each one shows |

## gateway

One address in front of all of it. It resolves the caller, applies a per-credential rate limit,
forwards to the service that owns the path, passes files through untouched, and reports ready
only when every service behind it is. Its routing table is tested against every path in the
published specification, so a route nobody can reach fails a test.
