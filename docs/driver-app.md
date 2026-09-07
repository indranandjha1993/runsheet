# The driver app

`apps/driver` is what runs on the handset: the day's runsheet, the actions at each stop, proof
capture, cash, and a queue that sends the shift to the platform when there is signal. It is
written so that nothing on screen ever waits for the network.

## Offline first

Every tap becomes an entry in a local queue with a command identifier minted on the device and
a device sequence number that only ever goes up, across restarts and across runs. The sequence is
the causal order of the driver's day and the only order the server trusts from the device.

When there is signal, the queue sends up to two hundred entries in one call to
`POST /v1/sync/batches`. The server answers per entry: `accepted`, `duplicate` (it already had
it), or `rejected` with a reason. Only entries the server explicitly settled leave the queue; a
dropped reply loses no work, because the next attempt sends the same entries under a new batch
identifier and the server recognises them.

Proof photographs and signatures are declared in the batch by hash and size, and the delivery is
recorded at once. The bytes go up separately on their own queue, content-addressed, so a device
may retry an upload forever without anything changing and a backlog of photographs delays no
delivery.

## The clock

A handset's wall clock is often wrong. The app sends both the wall time and a monotonic counter
since boot with every entry; the server anchors to the counter where the boot is unchanged
since the last contact and believes the wall clock only as a fallback, marking each reconciled
time with a confidence. Nothing is ever rejected for a bad clock.

## The runsheet

A run is downloaded once and worked through with no network. Each stop shows who, where, the
barcode (isolated so it reads correctly inside right-to-left text), what proof is needed, and
the cash to collect. A stop can be completed, failed with a reason, or skipped to come back to.
A skipped stop still counts as remaining, so a run cannot be closed with parcels on the vehicle.

A delivery that needs proof cannot be completed without it. A stop with cash to collect cannot be
completed without the money.

## Languages

English, Hindi, and Arabic, with Arabic laid out right to left. Grammar is never assembled from
parts: each language names things its own way rather than concatenating an article onto a noun.
Identifiers inside a sentence are wrapped in bidirectional isolates so a tracking number never
scrambles.

A fourth, pseudo, locale grows every string by about a third and accents every letter. Rendering
in it during development catches a layout that only fits English before an operator does.

## Building on it

The package exports the queue, the runsheet model, the translator, the screen renderers, and the
sync client as plain functions with no framework attached, so the same logic runs under whatever
shell you put around it: a web view, a native wrapper, or a test.
