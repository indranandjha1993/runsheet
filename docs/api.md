# The interface

One base address, the gateway. Locally that is `http://localhost:14000`; in a deployment,
whatever you put in front of it. Every route is listed with its request and responses in the
[generated reference](reference/routes.md), and the machine-readable form is `spec/openapi.json`.

## Authentication

Every request except the public tracking page carries an API key as a bearer token:

```
Authorization: Bearer rsk_...
```

Keys are issued per tenant by the identity service (`POST /v1/keys`) with a list of scopes. The
secret is returned once and stored only as a hash; keep it somewhere safe. Revoke a key with
`POST /v1/keys/{id}/revoke` and it stops working within thirty seconds everywhere.

## Tenancy

The tenant is whatever tenant the key belongs to. It is never read from a header, a query
parameter, or a body, so a credential cannot be pointed at somebody else's data. A request that
sends `x-tenant-id` gets exactly what it would have got without it.

The one, narrow exception: a key holding a `read_any` scope (held by platform services, never
issued to operators) may send `x-on-behalf-of-tenant` to say which tenant it is asking about.
The money service uses this to fetch delivery evidence from the orders service.

## Scopes

Scopes are `resource:read` or `resource:write`. A write scope implies the read scope for the
same resource. `pii:read` is never implied by anything.

| Resource       | Read lets you                         | Write lets you                                                          |
| -------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `consignments` | read consignments and their history   | book, record events, print labels, promise windows                      |
| `runs`         | read runs, hub scans, exceptions      | plan runs, record stops, capture proof, scan, sync, report observations |
| `network`      | read hubs and serviceability          | register hubs                                                           |
| `addresses`    | read a resolved address               | resolve and confirm addresses                                           |
| `linehaul`     | read bags, trips, manifests           | bag, seal, load, run trips                                              |
| `money`        | read settlements and statements       | rate cards, invoices, settlements, cash movements                       |
| `policies`     | read policies, decisions, calibration | publish policies, ask for decisions, record outcomes                    |
| `reports`      | run reports and baseline comparisons  |                                                                         |
| `pii`          | see personal data unmasked            |                                                                         |

## Requests and responses

Bodies are JSON with `snake_case` field names. Dates are ISO 8601; calendar dates with no time
are `YYYY-MM-DD` and never shift with a time zone. Money is always whole minor units plus a
three-letter currency code; there are no decimal amounts anywhere.

Identifiers are ULIDs: 26 characters, sortable by time of creation.

Errors have one shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "cod_amount_minor is required when payment is on delivery"
  }
}
```

| Status | Meaning                                                                               |
| ------ | ------------------------------------------------------------------------------------- |
| 400    | The request did not validate; the message says what was wrong                         |
| 401    | No usable credential                                                                  |
| 403    | The credential lacks the scope the route needs                                        |
| 404    | No such resource, or not one this tenant can see                                      |
| 409    | The change is not allowed from the current state, or the thing already exists         |
| 429    | The credential's rate allowance is spent; `ratelimit-remaining` says how much is left |
| 502    | The service behind the gateway did not respond                                        |

Every response carries a `traceparent` header. Quote it when reporting a problem.

## Idempotency

Where a retry could do damage, the platform is idempotent by design rather than by an optional
header:

- A sync batch is idempotent on each entry's `command_id`.
- A cash movement is idempotent on its kind and reference.
- A carrier invoice is idempotent on its number.
- An observation for a problem that is already open returns the open exception.
- A label reprint returns the same barcodes.

## Files

Some routes return a file instead of data: labels with `format: zpl`, and reports with
`format=csv`. The response carries `content-type` and `content-disposition`, and the body is the
file itself, not a JSON string containing it.

## Rate limits

Per credential, per minute. The limit and what is left are in `ratelimit-limit` and
`ratelimit-remaining` on every response.

## Webhooks

Deliveries are signed with a secret you hold: the header is `t=<unix seconds>,v1=<hex hmac>`,
and signatures are accepted within five minutes of the timestamp. Secrets can be rotated; the
platform verifies against every current secret. A failed delivery is retried eight times over
about a day, with backoff. The `@runsheet/webhooks` package holds the verifier you can reuse.

## The specifications

| File                    | Generated from                                                                  | Checked by                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `spec/openapi.json`     | each service's description of its own routes, using the same validation schemas | a test that the file matches the code, another that every registered route is described, another that the gateway can reach every path |
| `contracts/events.json` | the event catalogue                                                             | a test that the file matches the code, and a refusal at publish time of any uncatalogued event                                         |

Regenerate both with `make spec`.
