#!/bin/bash
# Brings up a working instance with one tenant, one key, and enough network to book against.
# Prints the credential; nothing is stored anywhere else.
set -e
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

GATEWAY="http://localhost:${PORT_GATEWAY:-14000}"

if ! curl -sf -o /dev/null "$GATEWAY/health"; then
  echo "Starting services..."
  bash infra/local/run-all.sh
fi

json() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

TENANT=$(curl -sf -X POST "$GATEWAY/v1/tenants" -H 'content-type: application/json' -d '{
  "name": "Sandbox",
  "country_code": "IN",
  "currency": "INR",
  "locale": "en-IN",
  "region": "ap-south"
}' | json "['id']")

SECRET=$(curl -sf -X POST "$GATEWAY/v1/keys" -H 'content-type: application/json' -d "{
  \"tenant_id\": \"$TENANT\",
  \"name\": \"sandbox\",
  \"scopes\": [\"consignments:write\", \"consignments:read\", \"runs:write\", \"runs:read\",
    \"network:write\", \"network:read\", \"addresses:write\", \"addresses:read\",
    \"linehaul:write\", \"linehaul:read\", \"money:write\", \"money:read\",
    \"policies:write\", \"policies:read\"]
}" | json "['secret']")

AUTH="Authorization: Bearer $SECRET"
JSON="content-type: application/json"

for hub in \
  '{"code":"BLR1","name":"Bengaluru South","country_code":"IN","time_zone":"Asia/Kolkata","latitude":12.9,"longitude":77.6,"opens_minutes_of_day":360,"closes_minutes_of_day":1320}' \
  '{"code":"DEL3","name":"Noida East","country_code":"IN","time_zone":"Asia/Kolkata","latitude":28.6,"longitude":77.4,"opens_minutes_of_day":360,"closes_minutes_of_day":1320}'
do
  curl -sf -o /dev/null -X POST "$GATEWAY/v1/hubs" -H "$AUTH" -H "$JSON" -d "$hub"
done

cat <<EOF

Sandbox ready at $GATEWAY

  tenant  $TENANT
  key     $SECRET

  Hubs BLR1 and DEL3 exist. The interface specification is spec/openapi.json and the
  event specification is contracts/events.json.

  curl -s $GATEWAY/v1/callers/current -H "Authorization: Bearer $SECRET"

Stop everything with: make sandbox-stop
EOF
