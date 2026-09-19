#!/bin/sh
# Print the last N log lines for the val in the current directory (default
# 5), newest first. Run from inside any val folder (wherever its .vt/
# lives) -- works for any val type (http, cron, email, script).
#
# `vt tail` streams a val's logs live but only forward from now; this
# fills the "what already happened" gap via val.town's REST API, using
# the same API key `vt` stores. No python/jq required -- just grep/sed,
# so it runs anywhere.

set -eu

if [ ! -f .vt/state.json ]; then
  echo "Run this from inside a val's folder (no .vt/state.json found here)." >&2
  exit 1
fi

n="${1:-5}"
api_key=$(vt config get apiKey | tail -1)
branch_id=$(sed -n '/"branch"/,/}/p' .vt/state.json | grep '"id"' | head -1 |
  sed -E 's/.*"id": *"([^"]*)".*/\1/')

curl -s "https://api.val.town/v1/telemetry/logs?branch_ids=$branch_id&direction=desc&limit=$n" \
  -H "Authorization: Bearer $api_key" |
  grep -oE '"body":\{"stringValue":"[^"]*"' |
  sed -E 's/.*"stringValue":"//; s/"$//'
