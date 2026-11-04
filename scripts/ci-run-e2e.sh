#!/usr/bin/env bash
# Runs one browser end-to-end npm script for CI. When it fails, the tail of its output (and of the
# app server log) is repeated as workflow annotations: the raw job log is not always downloadable,
# the annotations always are, so a red step explains itself.
#   usage: scripts/ci-run-e2e.sh "<label>" <npm-script>
set +e
label="$1"
script="$2"
log="/tmp/e2e-${script//[^a-zA-Z0-9]/-}.log"

npm run "$script" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}

if [ "$status" -ne 0 ]; then
  echo "::error title=${label} failed::$(tail -c 6000 "$log" | tr '\r\n' '||')"
  if [ -f /tmp/platform-server.log ]; then
    echo "::error title=App log after ${label}::$(tail -c 3000 /tmp/platform-server.log | tr '\r\n' '||')"
  fi
fi
exit "$status"
