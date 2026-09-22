#!/bin/sh
# Read, write, or list the Notes val's named notes.
#   ./notes.sh                    list note names
#   ./notes.sh <name>              read one note
#   ./notes.sh <name> "some text"  write (needs NOTES_PASSWORD, see below)
#   ./notes.sh <name> - < file     write from stdin
#
# NOTES_PASSWORD comes from the environment if already set, otherwise
# from a gitignored .env file (NOTES_PASSWORD=...) next to this script --
# so nothing needs exporting by hand, and the password never touches git.

set -eu
cd "$(dirname "$0")"

url=https://backspaces-notes.val.run

if [ $# -eq 0 ]; then
  curl -sS --fail-with-body "$url/"
  echo
  exit
fi

name="$1"

if [ $# -eq 1 ]; then
  curl -sS --fail-with-body "$url/$name"
  echo
  exit
fi

[ -f .env ] && . ./.env
: "${NOTES_PASSWORD:?set NOTES_PASSWORD in the environment or in .env}"

if [ "$2" = "-" ]; then
  curl -sS --fail-with-body -X POST -H "x-password: $NOTES_PASSWORD" \
    --data-binary @- "$url/$name"
else
  curl -sS --fail-with-body -X POST -H "x-password: $NOTES_PASSWORD" \
    --data-binary "$2" "$url/$name"
fi
echo
