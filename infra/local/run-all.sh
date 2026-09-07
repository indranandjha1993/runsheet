#!/bin/bash
# Starts every service in the background and waits for the gateway to report ready.
set -e
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

for service in identity network address orders execution planning promise exceptions money gateway; do
  node "services/$service/dist/main.js" > "/tmp/runsheet-$service.log" 2>&1 &
  echo $! >> /tmp/runsheet.pids
done

for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:${PORT_GATEWAY:-14000}/health"; then break; fi
  sleep 0.5
done
