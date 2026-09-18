#!/bin/sh
# Print the last N log lines for this val (default 5), newest first.
# Uses val.town's REST API directly since `vt` has no one-shot "latest logs"
# command (only `vt tail`, which streams forward from now).
#
# No python/jq required — just grep/sed, so it runs anywhere.

set -eu
cd "$(dirname "$0")"

n="${1:-5}"
api_key=$(vt config get apiKey | tail -1)
branch_id=$(sed -n '/"branch"/,/}/p' .vt/state.json | grep '"id"' | head -1 |
  sed -E 's/.*"id": *"([^"]*)".*/\1/')

curl -s "https://api.val.town/v1/telemetry/logs?branch_ids=$branch_id&direction=desc&limit=$n" \
  -H "Authorization: Bearer $api_key" |
  grep -oE '"body":\{"stringValue":"[^"]*"' |
  sed -E 's/.*"stringValue":"//; s/"$//'
