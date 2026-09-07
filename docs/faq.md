# Questions people ask

**Can I run this for my own operation?**
Yes. It is licensed under the AGPL v3, runs from a fresh clone, and depends on no domain or
account of ours. [Operations](operations.md) covers deploying it.

**What does the AGPL mean for me?**
Use it, change it, run it as a service. If you offer a changed version to others over a network,
you publish your changes under the same licence. If you only use it internally, nothing is
required of you.

**Does it need the cloud?**
No. PostgreSQL, Redis, a Kafka-compatible broker, and ClickHouse, all of which run in containers
on one machine for a small operation.

**How big an operation is it for?**
Built for fifty thousand to two million shipments a month, with the event backbone and one
database per service so that it scales by adding processes rather than by rewriting.

**Which countries?**
Built India first, with the Emirates in mind: cash on delivery is first class, addresses are
parsed as landmarks, and the driver app ships in English, Hindi, and Arabic with right-to-left
layout. Everything market-shaped is configuration.

**What is not finished?**
Two things a reader should know before relying on them. The reporting projections are not yet
fed from the event streams, so reports return no rows until the consumers that fill them are
built. And the services log every event they publish but do not yet relay them to the broker;
cross-service reactions that the design calls for (a hub scan moving the consignment, a run
close raising the cash exception on its own) still happen through the API calls the walkthrough
makes explicitly. Everything else on these pages runs end to end.

**Where is the web dashboard?**
Not built yet. The platform is the interface: every capability is a route, the specifications
are published, and the reports export as files. A web front end is on the backlog, and the
design tokens for it come with the first screen rather than ahead of it.

**Can I trust the automation?**
A policy cannot go live without a dry run and a shadow period in which it agreed with people
often enough, then a staged rollout. Every decision it makes records enough to be replayed. You
can roll it back from anywhere in one call.

**How does it talk to my carriers?**
Through [connectors](connectors.md). One interface, a runner that handles timeouts and retries,
and a working reference to copy.

**How do I integrate my order system?**
Book through `POST /v1/consignments` and subscribe to webhooks for what happens next. The
[interface page](api.md) has the details, and `spec/openapi.json` will generate you a client.

**Is my data separate from other operators'?**
Every row belongs to one tenant, and the tenant comes from the credential, never from a header.
A key cannot be pointed at somebody else's data.

**Has this carried a real parcel?**
Not yet. Every service is tested and runs end to end, and `make walkthrough` proves it on your
machine, but it has not been through a live operation. The baseline measurement exists so that
the first one is measured honestly.

**How do I contribute?**
See `CONTRIBUTING.md`. Sign off your commits; there is no agreement to sign.
