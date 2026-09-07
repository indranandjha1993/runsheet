#!/bin/bash
# Starts every service in the background and waits for the gateway to report ready.
set -e
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

start() {
  node "services/$1/dist/main.js" > "/tmp/runsheet-$1.log" 2>&1 &
  echo $! >> /tmp/runsheet.pids
}

# Identity first, because the money service needs a real credential of its own to ask the
# orders service about consignments. The placeholder in .env is never accepted by anything.
start identity
IDENTITY="http://localhost:${PORT_IDENTITY:-14200}"
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "$IDENTITY/health" && break
  sleep 0.25
done
PLATFORM=$(curl -sf -X POST "$IDENTITY/v1/tenants" -H 'content-type: application/json' \
  -d '{"name":"Platform","country_code":"IN","currency":"INR","locale":"en-IN","region":"ap-south"}' |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
SERVICE_CREDENTIAL=$(curl -sf -X POST "$IDENTITY/v1/keys" -H 'content-type: application/json' \
  -d "{\"tenant_id\":\"$PLATFORM\",\"name\":\"money-service\",\"scopes\":[\"consignments:read_any\"]}" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["secret"])')
export SERVICE_CREDENTIAL

for service in network address orders execution linehaul planning promise exceptions money policy reporting gateway; do
  start "$service"
done

# The console and the driver app, served from their build with platform calls forwarded to the
# gateway. Built here if nobody has built it yet.
[ -f apps/web/dist/index.html ] || pnpm --filter @runsheet/web build > /tmp/runsheet-web-build.log 2>&1
node apps/web/serve.js > /tmp/runsheet-web.log 2>&1 &
echo $! >> /tmp/runsheet.pids

for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:${PORT_GATEWAY:-14000}/health"; then break; fi
  sleep 0.5
done
