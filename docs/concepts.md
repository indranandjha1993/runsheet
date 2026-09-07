# Concepts

The platform is named after the objects a logistics operation already uses. Learn these and the
services, routes, and events read naturally.

## The parcel and its journey

**Consignment.** The unit of carriage: one shipment from an origin hub to a destination hub, on a
service level, made up of one or more **packages** with weights. It carries **guards** frozen at
booking: what proof a delivery needs, how many attempts are allowed, and for cash on delivery the
amount and currency to collect. It moves through a fixed set of states (booked, picked up, in
hub, in transit, out for delivery, attempted, delivered, returned, cancelled, lost) and each move
is an event. It knows its lane and, once delivered, exactly when.

**Order.** The merchant's reference for what was bought. One order can produce several
consignments. The order reference is what a merchant quotes; the consignment identifier is what
the network uses.

**Label.** One per package, with a barcode `RS` followed by nine digits and a check digit. The
check digit catches any single misread digit and any two adjacent digits swapped, so a bad scan
is refused rather than booked against the wrong parcel. A reprint gives the same barcodes.

**Address.** Parsed the way people write them: flat numbers, landmarks ("near the metro"),
postcodes. It carries a confidence that starts with the geocoder and rises every time a driver
confirms the pin at the door. A driver at the door always outranks a geocoder.

**Promise.** The window the customer was told, with a tracking token that opens a public page
carrying no personal data. The customer is messaged only when something changed that they would
act on.

## The network

**Hub.** A building that receives, sorts, and dispatches parcels. It has a code, a time zone, and
opening hours.

**Zone** and **serviceability.** Which points a hub can serve, and what can be promised there.

**Hub scan.** A parcel scanned into a hub, or out to a run. Re-weighing at the scan gives billing
the evidence it needs when a booked weight is disputed. A parcel nobody expected is accepted and
flagged, because refusing it leaves it on the floor with nobody responsible.

**Bag.** A sealed container of parcels going from one hub to another. It is open while parcels
go in, sealed with a seal number, loaded on a trip, received at the far end (seal intact or not),
and emptied. What did not come out is a discrepancy somebody works.

**Trip.** A vehicle and driver running bags between two hubs on a date. It carries a
**manifest**: the bags, their seals, and their parcel counts, so the far end can check the load
without opening anything.

## The field

**Run.** A driver's day: an ordered list of **stops**, each with **actions** (deliver, pick up,
return) against consignments. A run is planned, assigned a driver and vehicle, started, worked,
completed, and closed with a cash declaration.

**Proof.** What was captured at a stop: a photograph, a signature, a one-time code, a geofence
check. A delivery is recorded the moment the proof is declared by hash; the bytes arrive later
on their own queue and never hold anything up.

**Sync batch.** A driver's whole shift, sent from the handset in one call once there is signal.
Each tap has a command identifier the handset minted, so a retry over a bad link is recorded
once. The handset's clock is reconciled against its monotonic counter rather than believed.

**Plan.** The day's work packed into vehicles by stop count, weight, and shift length, with each
run sequenced. Nearest work is packed first, so what does not fit is the far outlier.

## The money

**Cash ledger.** Append-only entries against two accounts: what a driver is holding, and what a
merchant is owed. A collection credits both; banking clears the driver; a remittance clears the
merchant; a written-off shortfall clears the driver without paying the merchant, and needs an
approver. A mistake is corrected by a reversing entry, never by editing one.

**Rate card.** What a carrier charges, by lane, service, and weight band, valid between dates.

**Four-way match.** For each line on a carrier invoice: what was ordered, what the rate card says
it should cost, what actually happened (delivered, with proof, at this weight), and what was
billed. A line settles automatically when all four agree within tolerance; otherwise it waits
for a person as a **settlement** they can approve, dispute, or write off.

## Decisions and exceptions

**Exception.** Something a person must deal with, raised once per problem however many times the
network reports it, with a severity and a service-level clock.

**Policy.** An automation. It is published as a draft, passes a dry run, runs in **shadow**
recording what it would have done against what people did, is **staged** to a percentage of
subjects, then goes **live**. It has a daily budget and can be rolled back from anywhere.

**Decision.** One thing a policy did or proposed, recorded with its inputs, the exact policy
version and code, the stream positions it read, and any model exchange, so it can be replayed.

## Tenancy

**Tenant.** One operator. Every row in every service belongs to one. The tenant comes from the
credential presented, never from a header, so a caller cannot choose whose data they see. The
one exception is a platform service holding a read-any scope, which may say which tenant it is
asking on behalf of.
