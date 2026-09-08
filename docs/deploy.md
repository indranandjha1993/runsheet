# Deploy for your business

This page takes an operator from nothing to a running Runsheet on a machine of their own, in
order, with nothing assumed. It uses containers, so the steps are the same on a laptop, a server
in your office, or a virtual machine at any provider.

!!! note "What you get"
One host running PostgreSQL, Redis, a Kafka-compatible broker, ClickHouse, the twelve
services, the gateway on port 14000, and the console with the driver app on port 14100.

## 1. A machine

Any Linux server with Docker installed and about 4 GB of memory free. Ubuntu 24.04 with
`docker.io` and `docker-compose-v2` from its own packages is enough:

```sh
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER"   # then log out and in again
```

## 2. Get the code

```sh
git clone https://github.com/indranandjha1993/runsheet.git
cd runsheet
```

## 3. Write your settings

Every setting is an environment variable, documented in `.env.example`. Copy it beside the
deployment file and change the secrets:

```sh
cp .env.example infra/deploy/.env
```

Open `infra/deploy/.env` and set, at least:

| Variable             | Set it to                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`  | a long random password; it is used for every service's database                                 |
| `SIGNING_SECRET`     | a long random string; it signs tracking links and webhooks                                      |
| `PUBLIC_BASE_URL`    | the address your customers will open tracking links on, for example `https://track.example.com` |
| `SERVICE_CREDENTIAL` | leave for now; step 6 issues it                                                                 |

Generate random values with `openssl rand -hex 32`. Everything else can stay as it is; the
deployment file overrides the addresses services use to find each other.

## 4. Build and start

```sh
docker compose -f infra/deploy/compose.yaml up -d --build
```

The first build compiles everything and takes a few minutes. When it settles, check:

```sh
curl -s http://localhost:14000/health
```

It reports `ready` with a check per service. If any is not `ok`, its log says why:

```sh
docker compose -f infra/deploy/compose.yaml logs money
```

## 5. Create your operation and a key

```sh
curl -s -X POST http://localhost:14000/v1/tenants -H 'content-type: application/json' -d '{
  "name": "Your Company", "country_code": "IN", "currency": "INR", "locale": "en-IN", "region": "ap-south"
}'
```

Note the `id` it returns, then issue a key for your staff:

```sh
curl -s -X POST http://localhost:14000/v1/keys -H 'content-type: application/json' -d '{
  "tenant_id": "<the id>", "name": "operations",
  "scopes": ["consignments:write","runs:write","network:write","addresses:write","linehaul:write","money:write","policies:write","reports:read"]
}'
```

The `secret` is shown once. Store it somewhere safe. Anyone with it can act as your operation.

!!! warning "Lock down key creation"
Creating tenants and keys needs no credential, which is right for a fresh installation and
wrong for one on the internet. Put the gateway behind a reverse proxy that only allows
`/v1/tenants` and `/v1/keys` from your own network. Step 8 shows one.

## 6. The service credential

The money service reads delivery evidence from the orders service on your operation's behalf,
and needs a credential of its own. Create a tenant for the platform itself and a key with the
one scope that allows this:

```sh
curl -s -X POST http://localhost:14000/v1/tenants -H 'content-type: application/json' -d '{
  "name": "Platform", "country_code": "IN", "currency": "INR", "locale": "en-IN", "region": "ap-south"
}'
curl -s -X POST http://localhost:14000/v1/keys -H 'content-type: application/json' -d '{
  "tenant_id": "<the platform tenant id>", "name": "money-service", "scopes": ["consignments:read_any"]
}'
```

Put that secret in `infra/deploy/.env` as `SERVICE_CREDENTIAL` and restart the money service:

```sh
docker compose -f infra/deploy/compose.yaml up -d money
```

## 7. Register your hubs and try it

```sh
KEY=rsk_...
curl -s -X POST http://localhost:14000/v1/hubs -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "code": "BLR1", "name": "Bengaluru South", "country_code": "IN", "time_zone": "Asia/Kolkata",
  "latitude": 12.91, "longitude": 77.62, "opens_minutes_of_day": 360, "closes_minutes_of_day": 1320
}'
```

Then open the console at `http://localhost:14100`, paste the key, and you are on the board.
[The console, screen by screen](user-guide.md) takes it from there. ```sh
bash infra/deploy/check.sh

```

`infra/deploy/check.sh` does steps 5 to 7 for you, then runs the walkthrough: one consignment
through every service with every step asserted. It is the same check this project runs on its
own deployment before a release.

## 8. Put it on the internet

Only the gateway (14000) and the web app (14100) are published by the deployment; every other
container is reachable only inside the compose network. In front of those two, run a reverse
proxy that terminates TLS. With Caddy, this `Caddyfile` is the whole configuration:

```

console.example.com {
reverse_proxy localhost:14100
}

api.example.com {
@admin path /v1/tenants* /v1/keys*
handle @admin {
remote_ip 10.0.0.0/8 192.168.0.0/16
reverse_proxy localhost:14000
}
reverse_proxy localhost:14000
}

```

Set `PUBLIC_BASE_URL` to the address customers will use for tracking links and restart the
promise service. The web app forwards platform calls to the gateway itself, so it needs no
separate rule.

## 9. Keep it running

| Task                  | How                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| See what is happening | `docker compose -f infra/deploy/compose.yaml logs -f gateway`                                                 |
| Upgrade               | `git pull && docker compose -f infra/deploy/compose.yaml up -d --build`; migrations apply themselves          |
| Back up               | `docker compose -f infra/deploy/compose.yaml exec postgres pg_dumpall -U runsheet > backup.sql` on a schedule |
| Restore               | stop the services, `psql -U runsheet < backup.sql` into a fresh postgres volume, start again                  |
| Add a second machine  | each service is stateless; run more copies behind your proxy with the same `.env`                             |

[Operations](operations.md) covers configuration in full, health, logs, and how the databases
and migrations behave.

## Without containers

Every service is one Node process: `node services/<name>/dist/main.js`, reading its variables
from the environment. Build once with `pnpm install && pnpm build`, create the databases listed
in `infra/local/postgres/init/001-databases.sql`, start identity first, and run the rest with any
process manager you already use. `infra/local/run-all.sh` is a working example.
```
