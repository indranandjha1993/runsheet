# Getting started

By the end of this page you will have every service running locally, a tenant and a key, and one
parcel taken from booking to a settled carrier invoice.

## What you need

- Docker (any recent version; the local stack uses Compose)
- Node 24 or later
- pnpm (`corepack enable` gives you it with Node)

Nothing else. No accounts, no domains, no cloud.

## Clone and set up

```sh
git clone https://github.com/indranandjha1993/runsheet.git
cd runsheet
make setup
```

`make setup` copies `.env.example` to `.env`, installs dependencies, starts PostgreSQL, Redis, the
broker, and ClickHouse in containers, and applies every service's migrations. The defaults in
`.env.example` work as they are.

Ports are in the 13000 to 19999 range on purpose, so the stack does not collide with anything
else on your machine. The gateway is on 14000, PostgreSQL on 15432.

## Start everything

```sh
make sandbox
```

This builds and starts all twelve services behind the gateway, creates a tenant called Sandbox,
issues an API key for it, registers two hubs, and prints the key. Keep the key; it is shown once.

Check the whole platform is up:

```sh
curl -s http://localhost:14000/health
```

It reports `ready` only when every service behind the gateway is.

## Make your first calls

Put the key in a variable and ask who you are:

```sh
KEY=rsk_...
curl -s http://localhost:14000/v1/callers/current -H "Authorization: Bearer $KEY"
```

Book a parcel from Bengaluru to Noida, cash on delivery:

```sh
curl -s -X POST http://localhost:14000/v1/consignments \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{
    "order_reference": "ORD-1001",
    "origin_hub_code": "BLR1",
    "destination_hub_code": "DEL3",
    "service": "express",
    "payment_mode": "cod",
    "cod_amount_minor": 149900,
    "cod_currency": "INR",
    "proof_requirement": "signature",
    "attempt_limit": 3,
    "packages": [{ "weight_grams": 1200 }]
  }'
```

Amounts are always whole minor units (paise, fils, cents) with a currency code. There are no
floating-point amounts anywhere in the platform.

## Follow a parcel all the way through

Rather than typing thirty calls, run the walkthrough. It drives one consignment through every
service and asserts each step, so it doubles as the check that your installation is right:

```sh
make walkthrough
```

It takes a few seconds and prints what it did. [Business flows](flows.md) explains each step.

## Stop and clean up

```sh
make sandbox-stop   # stops the services, keeps the containers and data
make down           # stops the containers, keeps the data
make clean          # stops the containers and deletes the data
```

## What to read next

- [Concepts](concepts.md) for the vocabulary.
- [Operations](operations.md) when you want to run this somewhere other than your laptop.
- [The interface](api.md) when you want to integrate.
