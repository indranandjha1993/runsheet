# Runsheet documentation

Runsheet is an execution platform for logistics networks: it plans the day's work, runs it in
the field, closes the money, and can prove every automated decision it made. These pages are
everything needed to clone it, run it for a real operation, and understand it in detail.

| Start here                            |                                                                |
| ------------------------------------- | -------------------------------------------------------------- |
| [Getting started](getting-started.md) | From clone to a first delivery, in a few minutes               |
| [Concepts](concepts.md)               | The words the platform uses and what they mean                 |
| [Business flows](flows.md)            | Booking to settlement, step by step, with the calls that do it |

| Reference                          |                                                                 |
| ---------------------------------- | --------------------------------------------------------------- |
| [The services](services.md)        | One per bounded context: what each owns, and its routes         |
| [The interface](api.md)            | Authentication, tenancy, scopes, errors, and the specifications |
| [Events](events.md)                | What the platform publishes, and how to consume it              |
| [Every route](reference/routes.md) | Generated from the specification                                |
| [Every event](reference/events.md) | Generated from the catalogue                                    |

| Running it                      |                                                              |
| ------------------------------- | ------------------------------------------------------------ |
| [Operations](operations.md)     | Configuration, deployment, migrations, health, logs, backups |
| [The driver app](driver-app.md) | Offline queue, sync, three languages                         |
| [Connectors](connectors.md)     | Plugging a carrier in                                        |
| [Reporting](reporting.md)       | The six reports, export, and honest baseline measurement     |
| [Questions people ask](faq.md)  |                                                              |

The published specifications are the source of truth for anything these pages say about a
request or an event: `spec/openapi.json` and `contracts/events.json`. Both are generated from
the code and tested against it, and the two reference pages above are generated from them.
