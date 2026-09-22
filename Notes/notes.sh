#!/bin/sh
# Read or write the Notes val's note.
#   ./notes.sh              read
#   ./notes.sh "some text"  write (needs NOTES_PASSWORD, see below)
#   ./notes.sh - < file     write from stdin
#
# NOTES_PASSWORD comes from the environment if already set, otherwise
# from a gitignored .env file (NOTES_PASSWORD=...) next to this script --
# so nothing needs exporting by hand, and the password never touches git.

set -eu
cd "$(dirname "$0")"

url=https://backspaces-notes.val.run/

if [ $# -eq 0 ]; then
  curl -sS --fail-with-body "$url"
  exit
fi

[ -f .env ] && . ./.env
: "${NOTES_PASSWORD:?set NOTES_PASSWORD in the environment or in .env}"

if [ "$1" = "-" ]; then
  curl -sS --fail-with-body -X POST -H "x-password: $NOTES_PASSWORD" \
    --data-binary @- "$url"
else
  curl -sS --fail-with-body -X POST -H "x-password: $NOTES_PASSWORD" \
    --data-binary "$1" "$url"
fi
echo
