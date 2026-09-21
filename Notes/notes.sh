#!/bin/sh
# Read or write the Notes val's note.
#   ./notes.sh              read
#   ./notes.sh "some text"  write (needs NOTES_PASSWORD in the environment)
#   ./notes.sh - < file     write from stdin

set -eu

url=https://backspaces-notes.val.run/

if [ $# -eq 0 ]; then
  curl -sS --fail-with-body "$url"
  exit
fi

: "${NOTES_PASSWORD:?set NOTES_PASSWORD to the value of the Notes env var}"

if [ "$1" = "-" ]; then
  curl -sS --fail-with-body -X POST -H "x-password: $NOTES_PASSWORD" \
    --data-binary @- "$url"
else
  curl -sS --fail-with-body -X POST -H "x-password: $NOTES_PASSWORD" \
    --data-binary "$1" "$url"
fi
echo
