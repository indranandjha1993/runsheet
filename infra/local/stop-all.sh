#!/bin/bash
# Stops whatever run-all.sh started.
[ -f /tmp/runsheet.pids ] || exit 0
while read -r pid; do kill "$pid" 2>/dev/null || true; done < /tmp/runsheet.pids
rm -f /tmp/runsheet.pids
