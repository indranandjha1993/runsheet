# Security

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through the repository's
security advisory page, or by email to the address in the repository profile.

Tell us what you found, how to reproduce it, and what an attacker could do with it. You will get
an acknowledgement within three working days and an assessment within ten.

## What we consider a vulnerability

- Reading or writing another tenant's data through any path.
- Escalating from an ordinary read credential to personal data without the scope that gates it.
- Forging a tracking link, a webhook signature, or a device sync batch.
- Causing an automated decision to execute outside its declared bounds.
- Any way to make the system act on a request it should have refused.

## What we do not

- Findings that require access to the machine the software already runs on.
- Rate limiting on a self-hosted deployment, which is the operator's own configuration.
- Anything that depends on a deliberately weakened configuration, such as the development
  signing secret shipped in `.env.example`.

## Running it safely

Before deploying anywhere real, replace `SIGNING_SECRET` with a value from
`openssl rand -hex 32`, set `PUBLIC_BASE_URL` to your own address, and use credentials that are
not the development defaults. The example configuration is built for a laptop, not the internet.
