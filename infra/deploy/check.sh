#!/bin/bash
# Proves a containerised deployment the way the deployment guide describes it: creates the
# operation and the platform's own credential, restarts the money service with it, registers two
# hubs, then drives one consignment through every service. Run it against a fresh deployment:
#   bash infra/deploy/check.sh
set -e
cd "$(dirname "$0")/../.."
COMPOSE="docker compose -p ${COMPOSE_PROJECT:-runsheet-deploy} -f infra/deploy/compose.yaml"
G="http://localhost:${PORT_GATEWAY:-14000}"
JSON="content-type: application/json"
json() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

echo "waiting for the gateway to report ready"
for _ in $(seq 1 60); do curl -sf "$G/health" 2>/dev/null | grep -q '"ready"' && break; sleep 3; done
curl -sf "$G/health" | json "d['status']" | grep -q ready || { echo "the deployment is not ready"; curl -s "$G/health"; exit 1; }

echo "the platform's own credential, for reading evidence on an operation's behalf"
PLATFORM=$(curl -sf -X POST "$G/v1/tenants" -H "$JSON" -d '{"name":"Platform","country_code":"IN","currency":"INR","locale":"en-IN","region":"ap-south"}' | json "d['id']")
SERVICE=$(curl -sf -X POST "$G/v1/keys" -H "$JSON" -d "{\"tenant_id\":\"$PLATFORM\",\"name\":\"money-service\",\"scopes\":[\"consignments:read_any\"]}" | json "d['secret']")
if grep -q '^SERVICE_CREDENTIAL=' infra/deploy/.env; then
  sed -i.bak "s|^SERVICE_CREDENTIAL=.*|SERVICE_CREDENTIAL=$SERVICE|" infra/deploy/.env && rm -f infra/deploy/.env.bak
else
  printf 'SERVICE_CREDENTIAL=%s\n' "$SERVICE" >> infra/deploy/.env
fi
$COMPOSE up -d money >/dev/null 2>&1
for _ in $(seq 1 30); do curl -sf "$G/health" 2>/dev/null | grep -q '"ready"' && break; sleep 2; done

echo "one consignment through every service, asserting each step"
PORT_GATEWAY="${PORT_GATEWAY:-14000}" bash infra/local/walkthrough.sh
