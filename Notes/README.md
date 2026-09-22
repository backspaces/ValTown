# Notes

Fourth val — trying blob storage and environment variables.

- `http.ts` — any number of named notes, each a JSON blob under the key
  `note:<name>`. `GET /` lists note names; `GET /<name>` shows one;
  `POST /<name>` writes it, but only with the right password in an
  `x-password` header. The password lives in the `NOTES_PASSWORD`
  environment variable, read with `Deno.env.get`.

## Blob storage

```ts
import { blob } from "https://esm.town/v/std/blob/main.ts";
await blob.setJSON("note:shopping", { text: "milk, eggs" });
const note = await blob.getJSON("note:shopping"); // undefined if missing
const names = await blob.list("note:"); // all keys starting with "note:"
```

`blob.list(prefix)` is how one val holds many independent named items —
each note here is its own key, not rows in a table (that's `Mailbox`'s
SQLite approach instead). Its return shape isn't pinned down in the docs;
checked by temporarily logging it and reading the trace back (see
"Reading logs" in `Ticker/README.md`) — it's
`[{ key, size, lastModified }, ...]`, matching the columns the **Blob
Storage** sidebar tab shows.

Also `set`/`get` (any content, `get` returns a `Response`), `delete`,
`copy`, `move`. Free tier quota is 10 MB; keys up to 512 characters. See
the [blob reference](https://docs.val.town/reference/std/blob). The
**Blob Storage** item in the val's left sidebar browses what's stored.

## Environment variables

Set only through the web UI (left sidebar → **Env vars**), never from code
or `vt`, so this is another manual step: add `NOTES_PASSWORD` there. Changes
are picked up on the very next request, no redeploy. In a public val,
others can see that the variable is used but not its value, which is why
the password isn't in the code (or in this public GitHub repo). If the
variable is missing, `http.ts` refuses all writes instead of allowing them.
See the [env var reference](https://docs.val.town/reference/environment-variables).

## Trying it

Live at [backspaces-notes.val.run](https://backspaces-notes.val.run/)
(custom subdomain, like `Hello`).

```sh
URL=https://backspaces-notes.val.run/
curl $URL                                                # read
curl -X POST -H "x-password: <password>" -d "hello" $URL # write
```

`notes.sh` wraps those two `curl` calls:

```sh
./notes.sh              # read
./notes.sh "some text"  # write
./notes.sh - < file.txt # write from stdin
```

**Two separate, unrelated "env vars" are in play here**, easy to conflate:
the one set on val.town (above) is what `http.ts` checks server-side; it
has nothing to do with your local machine. `notes.sh` runs locally and
needs to know the same password just to send it as a header — for that it
reads `NOTES_PASSWORD` from the shell environment if already set, or
otherwise from a gitignored `Notes/.env` file (`NOTES_PASSWORD=...`) next
to the script. A plain shell `export` only lasts that one terminal
session (gone on the next tab or reboot); `.env` persists across sessions
without ever touching git. Either way, it exits nonzero on a rejected
write (401 for a wrong password).

Verified: a fresh read gives "(no note yet)", a POST with the wrong
password gets `401 Wrong password`, a POST with the right one saves and
the next `GET` returns the text plus an update timestamp.
