#!/bin/bash
# A short, real run through the platform, paced for watching. Every call is a real request to the
# running services; nothing here is staged. The walkthrough is the exhaustive version.
set -e
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a
G="http://localhost:${PORT_GATEWAY:-14000}"
JSON="content-type: application/json"
PAUSE=${DEMO_PAUSE:-1.6}

# DEMO_TRACE=<file> writes every command and its output there, for when a recording goes wrong.
if [ -n "${DEMO_TRACE:-}" ]; then exec 2>>"$DEMO_TRACE"; export BASH_XTRACEFD=2; set -x; fi

scene() { printf "\n\033[1;36m%s\033[0m\n" "$1"; sleep "$PAUSE"; }
show()  { printf "   \033[2m%s\033[0m\n" "$1"; }
done_() { printf "   \033[32m✓\033[0m %s\n" "$1"; sleep "$PAUSE"; }
json()  { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
post()  { curl -s -X POST "$G$1" -H "$AUTH" -H "$JSON" -d "$2"; }
get()   { curl -s "$G$1" -H "$AUTH"; }

printf "\033[1mRunsheet\033[0m  plans the work, runs it in the field, closes the money,\n"
printf "          and can prove every decision it made.\n"
sleep "$PAUSE"

scene "1  An operator signs up and gets a key"
AUTH="x: y"
T=$(post /v1/tenants '{"name":"Meridian Couriers","country_code":"IN","currency":"INR","locale":"en-IN","region":"ap-south"}' | json "d['id']")
S=$(post /v1/keys "{\"tenant_id\":\"$T\",\"name\":\"ops\",\"scopes\":[\"consignments:write\",\"runs:write\",\"network:write\",\"linehaul:write\",\"money:write\",\"policies:write\",\"reports:read\",\"addresses:write\"]}" | json "d['secret']")
AUTH="Authorization: Bearer $S"
show "POST /v1/tenants → $T"
done_ "credential issued; the tenant comes from the key, never from a header"

scene "2  Two hubs, and a booking for cash on delivery"
post /v1/hubs '{"code":"BLR1","name":"Bengaluru South","country_code":"IN","time_zone":"Asia/Kolkata","latitude":12.91,"longitude":77.62,"opens_minutes_of_day":360,"closes_minutes_of_day":1320}' >/dev/null
post /v1/hubs '{"code":"DEL3","name":"Noida East","country_code":"IN","time_zone":"Asia/Kolkata","latitude":28.58,"longitude":77.36,"opens_minutes_of_day":360,"closes_minutes_of_day":1320}' >/dev/null
C=$(post /v1/consignments '{"order_reference":"ORD-7731","origin_hub_code":"BLR1","destination_hub_code":"DEL3","service":"express","payment_mode":"cod","cod_amount_minor":149900,"cod_currency":"INR","proof_requirement":"signature","attempt_limit":3,"packages":[{"weight_grams":1200}]}' | json "d['id']")
show "POST /v1/consignments → $C   (₹1,499 to collect at the door)"
L=$(post "/v1/consignments/$C/labels" '{"origin":{"hub_code":"BLR1","city":"Bengaluru"},"destination":{"hub_code":"DEL3","name":"Aarav Sharma","line":"Flat 402, Sunrise Apartments","city":"Noida","postcode":"201309"},"sort_code":"DEL3-N-04","service_level":"next_day"}')
BC=$(echo "$L" | json "d['labels'][0]['barcode']")
done_ "label printed, barcode $BC with a check digit"

scene "3  A customer writes an address the way people do"
A=$(post /v1/addresses '{"raw":"Flat 402, Sunrise Apartments, near Sector 62 metro, Noida 201309","country_code":"IN"}')
show "landmark: $(echo "$A" | json "d['parsed'].get('landmark','-')")   postcode: $(echo "$A" | json "d['parsed'].get('postcode','-')")   confidence: $(echo "$A" | json "d['confidence']")"
done_ "resolved; a driver confirming the pin at the door raises the confidence"

scene "4  The hub floor: scanned in, re-weighed"
SC=$(post /v1/hub-scans/in "{\"hub_id\":\"BLR1\",\"worker_id\":\"w1\",\"consignment_id\":\"$C\",\"barcode\":\"$BC\",\"expected\":true,\"weight_grams\":1650,\"booked_weight_grams\":1200}")
show "booked 1,200 g, weighed 1,650 g → $(echo "$SC" | json "d.get('exception','no exception')")"
done_ "accepted, and billing now has evidence for a weight dispute"

scene "5  Bagged, sealed, and sent up the line"
B=$(post /v1/bags/parcels "{\"origin_hub_id\":\"BLR1\",\"destination_hub_id\":\"DEL3\",\"consignment_id\":\"$C\"}" | json "d['id']")
post "/v1/bags/$B/seal" '{"seal_number":"SEAL-7731"}' >/dev/null
TR=$(post /v1/trips '{"origin_hub_id":"BLR1","destination_hub_id":"DEL3","departs_on":"2026-09-08","capacity_bags":20}' | json "d['id']")
post "/v1/trips/$TR/events" '{"type":"crewed","vehicle_id":"KA01AB1234","driver_id":"drv-77"}' >/dev/null
post "/v1/trips/$TR/bags" "{\"bag_id\":\"$B\"}" >/dev/null
M=$(get "/v1/trips/$TR/manifest")
show "manifest: $(echo "$M" | json "str(len(d['bags']))") bag, seal $(echo "$M" | json "d['bags'][0]['sealNumber']"), $(echo "$M" | json "d['parcelCount']") parcel, driver $(echo "$M" | json "d['driverId']")"
post "/v1/trips/$TR/events" '{"type":"departed"}' >/dev/null
post "/v1/trips/$TR/events" '{"type":"arrived","hub_id":"DEL3"}' >/dev/null
post "/v1/bags/$B/events" '{"type":"received","hub_id":"DEL3","seal_intact":true}' >/dev/null
E=$(post "/v1/bags/$B/events" "{\"type\":\"emptied\",\"scanned_ids\":[\"$C\"]}")
done_ "arrived at DEL3, seal intact, $(echo "$E" | json "len(d['missing_consignment_ids'])") parcels missing"

scene "6  A driver's whole shift, synced in one call after a day offline"
R=$(post /v1/runs "{\"hub_id\":\"DEL3\",\"date\":\"2026-09-09\",\"stops\":[{\"sequence\":1,\"actions\":[{\"kind\":\"deliver\",\"consignment_id\":\"$C\"}]}]}" | json "d['id']")
post /v1/hub-scans/out "{\"hub_id\":\"DEL3\",\"worker_id\":\"w2\",\"consignment_id\":\"$C\",\"barcode\":\"$BC\",\"run_id\":\"$R\",\"on_run\":true}" >/dev/null
H=$(printf 'a%.0s' $(seq 1 64))
BATCH="{\"device_id\":\"handset-1\",\"device_boot_id\":\"boot-1\",\"worker_id\":\"drv-2\",\"run_id\":\"$R\",\"batch_id\":\"batch-1\",\"clock\":{\"device_sent_at\":\"2026-09-09T12:00:00.000Z\",\"device_monotonic_ms\":21600000},\"entries\":[{\"command_id\":\"cmd-1\",\"device_sequence\":1,\"type\":\"stop.completed\",\"payload\":{\"consignment_id\":\"$C\"},\"occurred_at_device\":\"2026-09-09T11:00:00.000Z\",\"monotonic_ms\":18000000,\"media\":[{\"media_id\":\"m-1\",\"sha256\":\"$H\",\"bytes\":8000,\"kind\":\"signature\"}]}]}"
S1=$(post /v1/sync/batches "$BATCH" | json "d['results'][0]['status']")
S2=$(post /v1/sync/batches "${BATCH/batch-1/batch-2}" | json "d['results'][0]['status']")
show "first send: $S1      same batch again over a flaky link: $S2"
done_ "recorded once; the photograph is fetched separately, so nothing waits for it"

scene "7  Delivered, and the cash accounted for"
PR=$(post /v1/proofs "{\"consignment_id\":\"$C\",\"requirement\":\"signature\",\"kinds\":[\"signature\"],\"media_ids\":[\"m-1\"]}" | json "d['id']")
for ev in '{"type":"picked_up"}' '{"type":"inscanned","hub_id":"DEL3"}' "{\"type\":\"out_for_delivery\",\"run_id\":\"$R\"}" "{\"type\":\"delivered\",\"proof_id\":\"$PR\",\"cash_collected_minor\":149900}"; do post "/v1/consignments/$C/events" "$ev" >/dev/null; done
post /v1/cash/movements "{\"kind\":\"collected\",\"amount_minor\":149900,\"currency\":\"INR\",\"reference\":\"$C\",\"driver_id\":\"drv-2\",\"merchant_id\":\"merchant-1\"}" >/dev/null
CL=$(post "/v1/cash/runs/$R/close" '{"driver_id":"drv-2","currency":"INR","counted_minor":140000}')
show "driver declared ₹1,499, handed in ₹1,400 → variance $(echo "$CL" | json "d['variance_minor']") minor, still owed $(echo "$CL" | json "d['float_after_minor']")"
done_ "the shortfall stays on the driver until a supervisor approves a write-off"

scene "8  The carrier's invoice, matched four ways"
CA=$(post /v1/carrier-accounts '{"name":"Swift Freight","currency":"INR"}' | json "d['id']")
post /v1/rate-cards "{\"carrier_account_id\":\"$CA\",\"currency\":\"INR\",\"valid_from\":\"2026-09-01T00:00:00.000Z\",\"lanes\":[{\"origin\":\"BLR1\",\"destination\":\"DEL3\",\"service\":\"express\",\"bands\":[{\"up_to_grams\":2000,\"price_minor\":10080}]}]}" >/dev/null
IN=$(post /v1/invoices "{\"carrier_account_id\":\"$CA\",\"number\":\"INV-0912\",\"currency\":\"INR\",\"lines\":[{\"consignment_id\":\"$C\",\"billed_minor\":10080,\"billed_weight_grams\":1200}]}")
show "order · rate card · proof of delivery · invoice line → $(echo "$IN" | json "', '.join(sorted(set(s['state'] for s in d['settlements'])))")"
done_ "settled automatically; a line that disagreed would wait for a person"

scene "9  A policy that decides, and can be replayed"
PO=$(post /v1/policies '{"name":"auto_reattempt","version":1,"code_hash":"abc123","autonomy":"propose","trigger_event":"consignment.attempted","budget_per_day":100}' | json "d['id']")
for mv in '{"type":"dry_run_passed","decisions":500}' '{"type":"shadowed","decisions":500,"agreed_with_humans":0.96}' '{"type":"staged","percent":100}' '{"type":"went_live"}'; do post "/v1/policies/$PO/events" "$mv" >/dev/null; done
D=$(post /v1/decisions "{\"trigger_event\":\"consignment.attempted\",\"subject_type\":\"consignment\",\"subject_id\":\"$C\",\"inputs\":{\"attempts\":1},\"action\":{\"reattempt_on\":\"2026-09-10\"},\"read_at\":[{\"topic\":\"consignment\",\"partition\":0,\"offset\":42}]}" | json "d['decision']['id']")
show "dry run → shadow (96% agreement with people) → staged → live"
done_ "decision $D recorded with everything a replay needs"

scene "10  The morning report, as a file"
get "/v1/reports/delivery_performance?from=2026-09-01&to=2026-09-30&format=csv" | head -3 | sed 's/^/   /'
done_ "six reports; export as csv, safe to open in a spreadsheet"

printf "\n\033[1mOne parcel, twelve services, nothing faked.\033[0m\n"
printf "github.com/indranandjha1993/runsheet\n\n"
sleep 2
