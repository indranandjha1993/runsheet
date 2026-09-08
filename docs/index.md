# Runsheet

Runsheet is an open-source execution platform for logistics networks. It plans the day's work,
runs it in the field, closes the money, and can prove every automated decision it made. It is
built for couriers, postal operators, and distributors moving fifty thousand to two million
shipments a month, and it runs on your own machines.

![The console](screens/board.png){ width="66%" }
![The driver app](screens/driver-ar.png){ width="31%" }

## Where to go

| If you want to                         | Read                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| See it run in ten minutes              | [Getting started](getting-started.md)                                              |
| Put it in front of your own operation  | [Deploy for your business](deploy.md), then [Operations](operations.md)            |
| Learn what each screen does            | [The console, screen by screen](user-guide.md) and [The driver app](driver-app.md) |
| Connect your order system or a carrier | [The interface](api.md), [Events](events.md), [Connectors](connectors.md)          |
| Understand how it is built             | [Concepts](concepts.md), [Business flows](flows.md), [The services](services.md)   |

## What it does

| The problem                           | What Runsheet does about it                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Addresses written as landmarks        | Parses them the way people write them, and learns from every driver who confirms the pin      |
| A hub floor with thousands of parcels | Scan in, scan out, re-weigh; an unexpected parcel is flagged, a misread barcode is refused    |
| Freight between cities                | Sealed bags, trips, and a manifest checked without opening anything                           |
| A driver with no signal               | An app that never waits for the network; a whole shift synced in one call, recorded once      |
| Cash on delivery                      | A ledger where a shortfall stays owed until somebody with the authority writes it off         |
| Carrier invoices                      | Every line matched four ways; the ones that agree settle themselves                           |
| Automation nobody trusts              | Dry run, shadow against people, staged rollout, live; every decision replayable               |
| "How did we do?"                      | Six reports, file export, and a baseline comparison that refuses to call noise an improvement |

## The specifications

Everything these pages say about a request or an event comes from two generated files that are
tested against the code: `spec/openapi.json` for every route and `contracts/events.json` for
every event. [Every route](reference/routes.md) and [every event](reference/events.md) are
generated from them.

## Licence

GNU Affero General Public License v3.0. Use it, change it, run it as a service; if you offer a
changed version to others over a network, publish your changes.
