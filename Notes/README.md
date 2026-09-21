# Notes

Fourth val — trying blob storage and environment variables.

- `http.ts` — one note, stored as a JSON blob under the key `note`.
  `GET` shows it; `POST` replaces it, but only with the right password in
  an `x-password` header. The password lives in the `NOTES_PASSWORD`
  environment variable, read with `Deno.env.get`.

## Blob storage

```ts
import { blob } from "https://esm.town/v/std/blob/main.ts";
await blob.setJSON("note", { text: "hi" });
const note = await blob.getJSON("note"); // undefined if missing
```

Also `set`/`get` (any content, `get` returns a `Response`), `list`,
`delete`, `copy`, `move`. Free tier quota is 10 MB; keys up to 512
characters. See the [blob reference](https://docs.val.town/reference/std/blob).
The **Blob Storage** item in the val's left sidebar browses what's stored.

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
./notes.sh                       # read
export NOTES_PASSWORD=<password> # once per shell; never put it in the script
./notes.sh "some text"           # write
./notes.sh - < file.txt          # write from stdin
```

It refuses to write if `NOTES_PASSWORD` isn't set, and exits nonzero on a
rejected write (401 for a wrong password). The URL is hardcoded to this
val's subdomain.

Verified: a fresh read gives "(no note yet)", a POST with the wrong
password gets `401 Wrong password`, a POST with the right one saves and
the next `GET` returns the text plus an update timestamp.
