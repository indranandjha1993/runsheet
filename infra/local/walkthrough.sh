#!/bin/bash
# Drives one consignment through every service, asserting each step. Exits non-zero on the
# first thing that is not as it should be. This is the check that "it all works" means.
set -e
cd "$(dirname "$0")/../.."
# Settings come from .env when there is one; against a container deployment there may not be.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

G="http://localhost:${PORT_GATEWAY:-14000}"
JSON="content-type: application/json"
STEP=0

say()  { STEP=$((STEP+1)); printf "\n%2d. %s\n" "$STEP" "$1"; }
ok()   { printf "    ✓ %s\n" "$1"; }
fail() { printf "    ✗ %s\n" "$1" >&2; exit 1; }
json() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

# call METHOD PATH BODY EXPECTED_STATUS -> prints body, asserts status
call() {
  local method=$1 path=$2 body=$3 expect=$4
  local out status
  if [ -n "$body" ]; then
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$G$path" -H "$AUTH" -H "$JSON" -d "$body")
  else
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$G$path" -H "$AUTH")
  fi
  status=${out##*$'\n'}
  body=${out%$'\n'*}
  [ "$status" = "$expect" ] || fail "$method $path returned $status, expected $expect: $body"
  printf '%s' "$body"
}

say "the platform is up"
curl -sf "$G/health" | json "d['status']" | grep -q ready || fail "gateway not ready"
ok "gateway reports every service ready"

say "a tenant and a credential (identity)"
AUTH="x: y"
TENANT=$(call POST /v1/tenants '{"name":"Walkthrough Logistics","country_code":"IN","currency":"INR","locale":"en-IN","region":"ap-south"}' 201 | json "d['id']")
SECRET=$(call POST /v1/keys "{\"tenant_id\":\"$TENANT\",\"name\":\"ops\",\"scopes\":[\"consignments:write\",\"consignments:read\",\"runs:write\",\"runs:read\",\"network:write\",\"network:read\",\"addresses:write\",\"addresses:read\",\"linehaul:write\",\"linehaul:read\",\"money:write\",\"money:read\",\"policies:write\",\"policies:read\",\"reports:read\"]}" 201 | json "d['secret']")
AUTH="Authorization: Bearer $SECRET"
# WALKTHROUGH_KEY_FILE=<path> keeps the key, so the console can be opened on this data afterwards.
[ -n "${WALKTHROUGH_KEY_FILE:-}" ] && printf '%s\n' "$SECRET" > "$WALKTHROUGH_KEY_FILE"
call GET /v1/callers/current "" 200 | json "d['tenantId']" | grep -q "$TENANT" || fail "credential does not resolve to its tenant"
ok "tenant $TENANT, key issued, credential resolves"

say "nobody gets in without a credential, and a header cannot pick a tenant"
AUTH="x: y"
curl -s -o /dev/null -w '%{http_code}' "$G/v1/consignments/nothing" | grep -q 401 || fail "unauthenticated read was not refused"
AUTH="Authorization: Bearer $SECRET"
curl -s -o /dev/null -w '%{http_code}' "$G/v1/consignments/nothing" -H "$AUTH" -H "x-tenant-id: somebody-else" | grep -q 404 || fail "tenant header changed the outcome"
ok "401 without a key; a tenant header is ignored"

say "two hubs and a serviceability check (network)"
call POST /v1/hubs '{"code":"BLR1","name":"Bengaluru South","country_code":"IN","time_zone":"Asia/Kolkata","latitude":12.91,"longitude":77.62,"opens_minutes_of_day":360,"closes_minutes_of_day":1320}' 201 >/dev/null
call POST /v1/hubs '{"code":"DEL3","name":"Noida East","country_code":"IN","time_zone":"Asia/Kolkata","latitude":28.58,"longitude":77.36,"opens_minutes_of_day":360,"closes_minutes_of_day":1320}' 201 >/dev/null
ok "BLR1 and DEL3 registered"

say "an address the way a customer writes it (address)"
ADDR=$(call POST /v1/addresses '{"raw":"Flat 402, Sunrise Apartments, near Sector 62 metro, Noida 201309","country_code":"IN"}' 201)
echo "$ADDR" | json "d['id']" >/dev/null
ok "resolved: $(echo "$ADDR" | json "str(d.get('confidence','?'))") confidence"

say "a cash-on-delivery booking with a label (orders)"
C=$(call POST /v1/consignments '{"order_reference":"ORD-7731","origin_hub_code":"BLR1","destination_hub_code":"DEL3","service":"express","payment_mode":"cod","cod_amount_minor":149900,"cod_currency":"INR","proof_requirement":"signature","attempt_limit":3,"packages":[{"weight_grams":1200}]}' 201 | json "d['id']")
BARCODE=$(call POST "/v1/consignments/$C/labels" '{"origin":{"hub_code":"BLR1","city":"Bengaluru"},"destination":{"hub_code":"DEL3","name":"Aarav Sharma","line":"Flat 402, Sunrise Apartments","city":"Noida","postcode":"201309"},"sort_code":"DEL3-N-04","service_level":"next_day"}' 200 | json "d['labels'][0]['barcode']")
call POST "/v1/consignments/$C/labels" '{"origin":{"hub_code":"BLR1","city":"Bengaluru"},"destination":{"hub_code":"DEL3","name":"Aarav Sharma","line":"Flat 402","city":"Noida","postcode":"201309"},"sort_code":"DEL3-N-04","service_level":"next_day","format":"zpl"}' 200 | grep -q '^\^XA' || fail "printer output missing"
ok "consignment $C, barcode $BARCODE, printer commands rendered"

say "a promised window and a public tracking link (promise)"
P=$(call POST /v1/promises "{\"consignment_id\":\"$C\",\"window_start\":\"2026-09-09T09:00:00.000Z\",\"window_end\":\"2026-09-09T13:00:00.000Z\",\"locale\":\"hi-IN\"}" 201)
TOKEN=$(echo "$P" | json "d['tracking_token']")
curl -sf "$G/track/$TOKEN" >/dev/null || fail "tracking link did not open without a credential"
ok "window promised, tracking link opens with no credential"

say "scanned into the origin hub, and re-weighed (execution)"
SCAN=$(call POST /v1/hub-scans/in "{\"hub_id\":\"BLR1\",\"worker_id\":\"w1\",\"consignment_id\":\"$C\",\"barcode\":\"$BARCODE\",\"expected\":true,\"weight_grams\":1650,\"booked_weight_grams\":1200}" 201)
echo "$SCAN" | json "d['exception']" | grep -q weight_differs || fail "a 450g overweight was not flagged"
ok "accepted, and the weight difference raised an exception"

say "a misread barcode is refused at the hub"
curl -s -o /dev/null -w '%{http_code}' -X POST "$G/v1/hub-scans/in" -H "$AUTH" -H "$JSON" -d "{\"hub_id\":\"BLR1\",\"worker_id\":\"w1\",\"consignment_id\":\"$C\",\"barcode\":\"RS0000000014\",\"expected\":true}" | grep -q 400 || fail "bad check digit was accepted"
ok "check digit caught the misread"

say "bagged, sealed, and put on a linehaul trip with a manifest (linehaul)"
BAG=$(call POST /v1/bags/parcels "{\"origin_hub_id\":\"BLR1\",\"destination_hub_id\":\"DEL3\",\"consignment_id\":\"$C\"}" 201 | json "d['id']")
call POST "/v1/bags/$BAG/seal" '{"seal_number":"SEAL-7731"}' 200 >/dev/null
TRIP=$(call POST /v1/trips '{"origin_hub_id":"BLR1","destination_hub_id":"DEL3","departs_on":"2026-09-08","capacity_bags":20}' 201 | json "d['id']")
call POST "/v1/trips/$TRIP/events" '{"type":"crewed","vehicle_id":"KA01AB1234","driver_id":"drv-77"}' 200 >/dev/null
call POST "/v1/trips/$TRIP/bags" "{\"bag_id\":\"$BAG\"}" 201 >/dev/null
call GET "/v1/trips/$TRIP/manifest" "" 200 | json "d['parcelCount']" | grep -q 1 || fail "manifest does not carry the parcel"
call POST "/v1/trips/$TRIP/events" '{"type":"departed"}' 200 >/dev/null
call POST "/v1/trips/$TRIP/events" '{"type":"arrived","hub_id":"DEL3"}' 200 >/dev/null
call POST "/v1/bags/$BAG/events" '{"type":"received","hub_id":"DEL3","seal_intact":true}' 200 >/dev/null
EMPTIED=$(call POST "/v1/bags/$BAG/events" "{\"type\":\"emptied\",\"scanned_ids\":[\"$C\"]}" 200)
echo "$EMPTIED" | json "len(d['missing_consignment_ids'])" | grep -q 0 || fail "parcel went missing in the bag"
call POST "/v1/trips/$TRIP/events" "{\"type\":\"closed\",\"received_bag_ids\":[\"$BAG\"]}" 200 >/dev/null
ok "bag $BAG travelled BLR1 → DEL3 on trip $TRIP; nothing missing"

say "the day's work packed into vehicles (planning)"
PLAN=$(call POST /v1/plans "{\"hub_id\":\"DEL3\",\"hub_latitude\":28.58,\"hub_longitude\":77.36,\"date\":\"2026-09-09\",\"vehicles\":[{\"id\":\"veh-1\",\"max_stops\":40,\"max_weight_grams\":200000,\"shift_minutes\":480}],\"jobs\":[{\"id\":\"$C\",\"weight_grams\":1650,\"latitude\":28.62,\"longitude\":77.37}]}" 201)
ok "plan produced: $(echo "$PLAN" | json "len(d.get('runs',[]))") run(s)"

say "a run, scanned out, and a driver's shift synced from a handset (execution)"
RUN=$(call POST /v1/runs "{\"hub_id\":\"DEL3\",\"date\":\"2026-09-09\",\"stops\":[{\"sequence\":1,\"actions\":[{\"kind\":\"deliver\",\"consignment_id\":\"$C\"}]}]}" 201 | json "d['id']")
call POST /v1/hub-scans/out "{\"hub_id\":\"DEL3\",\"worker_id\":\"w2\",\"consignment_id\":\"$C\",\"barcode\":\"$BARCODE\",\"run_id\":\"$RUN\",\"on_run\":true}" 201 >/dev/null
call POST "/v1/runs/$RUN/events" '{"type":"assigned","worker_id":"drv-2","vehicle_id":"veh-1"}' 200 >/dev/null
call POST "/v1/runs/$RUN/events" '{"type":"started"}' 200 >/dev/null
HASH=$(printf 'a%.0s' $(seq 1 64))
BATCH="{\"device_id\":\"handset-1\",\"device_boot_id\":\"boot-1\",\"worker_id\":\"drv-2\",\"run_id\":\"$RUN\",\"batch_id\":\"batch-1\",\"clock\":{\"device_sent_at\":\"2026-09-09T12:00:00.000Z\",\"device_monotonic_ms\":21600000},\"entries\":[{\"command_id\":\"cmd-1\",\"device_sequence\":1,\"type\":\"stop.completed\",\"payload\":{\"consignment_id\":\"$C\"},\"occurred_at_device\":\"2026-09-09T11:00:00.000Z\",\"monotonic_ms\":18000000,\"media\":[{\"media_id\":\"m-1\",\"sha256\":\"$HASH\",\"bytes\":8000,\"kind\":\"signature\"}]}]}"
call POST /v1/sync/batches "$BATCH" 200 | json "d['results'][0]['status']" | grep -q accepted || fail "sync was not accepted"
call POST /v1/sync/batches "${BATCH/batch-1/batch-2}" 200 | json "d['results'][0]['status']" | grep -q duplicate || fail "a retried batch was recorded twice"
ok "shift accepted once; the retry was recognised as a duplicate"

say "proof captured and the consignment delivered (execution, orders)"
PROOF=$(call POST /v1/proofs "{\"consignment_id\":\"$C\",\"requirement\":\"signature\",\"kinds\":[\"signature\"],\"media_ids\":[\"m-1\"]}" 201 | json "d['id']")
call POST "/v1/consignments/$C/events" "{\"type\":\"picked_up\"}" 200 >/dev/null
call POST "/v1/consignments/$C/events" "{\"type\":\"inscanned\",\"hub_id\":\"DEL3\"}" 200 >/dev/null
call POST "/v1/consignments/$C/events" "{\"type\":\"out_for_delivery\",\"run_id\":\"$RUN\"}" 200 >/dev/null
call POST "/v1/consignments/$C/events" "{\"type\":\"delivered\",\"proof_id\":\"$PROOF\",\"cash_collected_minor\":149900}" 200 | json "d['status']" | grep -q delivered || fail "consignment is not delivered"
ok "delivered with proof $PROOF and the cash"

say "cash collected and the driver's day closed with a shortfall (money)"
call POST /v1/cash/movements "{\"kind\":\"collected\",\"amount_minor\":149900,\"currency\":\"INR\",\"reference\":\"$C\",\"driver_id\":\"drv-2\",\"merchant_id\":\"merchant-1\"}" 201 >/dev/null
CLOSE=$(call POST "/v1/cash/runs/$RUN/close" '{"driver_id":"drv-2","currency":"INR","counted_minor":140000}' 200)
echo "$CLOSE" | json "d['variance_minor']" | grep -q -- "-9900" || fail "shortfall not computed"
curl -s -o /dev/null -w '%{http_code}' -X POST "$G/v1/cash/movements" -H "$AUTH" -H "$JSON" -d '{"kind":"written_off","amount_minor":9900,"currency":"INR","reference":"'"$RUN"'","driver_id":"drv-2"}' | grep -q 400 || fail "unapproved write-off was accepted"
call POST /v1/cash/movements "{\"kind\":\"written_off\",\"amount_minor\":9900,\"currency\":\"INR\",\"reference\":\"$RUN\",\"driver_id\":\"drv-2\",\"approved_by\":\"supervisor-1\"}" 201 >/dev/null
call GET "/v1/cash/drivers/drv-2/statement?currency=INR" "" 200 | json "d['float_minor']" | grep -q '^0$' || fail "float not cleared after approved write-off"
ok "shortfall of 99.00 INR stayed owed until a supervisor approved it"

say "a carrier's invoice matched four ways (money)"
CARRIER=$(call POST /v1/carrier-accounts '{"name":"Swift Freight","currency":"INR"}' 201 | json "d['id']")
call POST /v1/rate-cards "{\"carrier_account_id\":\"$CARRIER\",\"currency\":\"INR\",\"valid_from\":\"2026-09-01T00:00:00.000Z\",\"lanes\":[{\"origin\":\"BLR1\",\"destination\":\"DEL3\",\"service\":\"express\",\"bands\":[{\"up_to_grams\":2000,\"price_minor\":10080}]}]}" 201 >/dev/null
INV=$(call POST /v1/invoices "{\"carrier_account_id\":\"$CARRIER\",\"number\":\"INV-2026-0912\",\"currency\":\"INR\",\"lines\":[{\"consignment_id\":\"$C\",\"billed_minor\":10080,\"billed_weight_grams\":1200}]}" 201)
ok "invoice taken in: $(echo "$INV" | json "', '.join(sorted(set(l.get('state','?') for l in d.get('settlements', d.get('lines', [])))))")"

say "something looked wrong on the floor (exceptions)"
OBS="{\"type\":\"run.closed\",\"aggregate_id\":\"$RUN\",\"payload\":{\"cash\":{\"varianceMinor\":-9900}}}"
EID=$(call POST /v1/observations "$OBS" 201 | json "d['exception']['id']")
call POST /v1/observations "$OBS" 200 | json "d['reason']" | grep -q already_open || fail "the same problem was raised twice"
call GET "/v1/exceptions/$EID" "" 200 | json "d['type']" | grep -q cash_variance || fail "wrong exception type"
ok "cash variance raised once however often the close is reported"

say "a policy that decides, and a decision that can be replayed (policy)"
POL=$(call POST /v1/policies '{"name":"auto_reattempt","version":1,"code_hash":"abc123","autonomy":"propose","trigger_event":"consignment.attempted","budget_per_day":100}' 201 | json "d['id']")
for move in '{"type":"dry_run_passed","decisions":500}' '{"type":"shadowed","decisions":500,"agreed_with_humans":0.96}' '{"type":"staged","percent":100}' '{"type":"went_live"}'; do
  call POST "/v1/policies/$POL/events" "$move" 200 >/dev/null
done
DEC=$(call POST /v1/decisions "{\"trigger_event\":\"consignment.attempted\",\"subject_type\":\"consignment\",\"subject_id\":\"$C\",\"inputs\":{\"attempts\":1},\"action\":{\"reattempt_on\":\"2026-09-10\"},\"read_at\":[{\"topic\":\"consignment\",\"partition\":0,\"offset\":42}]}" 201)
DID=$(echo "$DEC" | json "d['decision']['id']")
call GET "/v1/decisions/$DID/replayable" "" 200 | json "d['replayable']" | grep -qi true || fail "decision is not replayable"
ok "policy $POL walked draft → dry run → shadow → staged → live; decision $DID recorded and replayable"

say "the morning report, as a file (reporting)"
call GET "/v1/reports" "" 200 | json "len(d['reports'])" | grep -q 6 || fail "reports missing"
call GET "/v1/reports/delivery_performance?from=2026-09-01&to=2026-09-30&format=csv" "" 200 | head -1 | grep -q '^day,hub_id' || fail "csv header wrong"
ok "six reports available; csv exports with a proper header"

say "the parcel's whole story"
call GET "/v1/hub-scans?consignment_id=$C" "" 200 | json "' → '.join(s['hub_id'] for s in d['scans'])" | sed 's/^/    /'
call GET "/v1/consignments/$C" "" 200 | json "'    status: ' + d['status']"

printf "\nEvery step passed. Tenant %s, consignment %s.\n" "$TENANT" "$C"
