#!/bin/sh
# Print the last N log lines for this val (default 5), newest first.
# Uses val.town's REST API directly since `vt` has no one-shot "latest logs"
# command (only `vt tail`, which streams forward from now).

set -eu
cd "$(dirname "$0")"

n="${1:-5}"
api_key=$(vt config get apiKey | tail -1)
branch_id=$(python3 -c "import json; print(json.load(open('.vt/state.json'))['branch']['id'])")

curl -s "https://api.val.town/v1/telemetry/logs?branch_ids=$branch_id&direction=desc&limit=$n" \
  -H "Authorization: Bearer $api_key" |
  python3 -c "
import json, sys
for entry in json.load(sys.stdin)['data']:
    print(entry['body']['stringValue'])
"
