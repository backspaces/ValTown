# Rest, line by line

A walkthrough of [http.ts](http.ts), explaining the JavaScript as it
goes. [README.md](README.md) says what Rest does; this file says how the
code does it. It builds on [RoomsBreakdown.md](../Rooms/RoomsBreakdown.md):
ideas explained there (arrow functions, spread, default parameters,
`??=`, `3600_000`, why module variables last "once per isolate") are
only pointed to here.

`http.ts` (182 lines) has four parts:

1. **Settings** (lines 1–27): limits, CORS headers, the table.
2. **Replies** (lines 29–70): what `GET /` says, the HTML page, and
   `reply()`, which every response goes through.
3. **Items** (lines 72–117): turning rows into JSON, reading a request's
   body, and storing an item.
4. **Routing** (lines 119–182): one object of handlers per kind of
   resource, and the entry point that picks one.

The whole design is in part 4, so it can help to read that first.

## Settings (lines 1–27)

[http.ts:5-8](http.ts#L5-L8): the limits from the README's "Limits"
section, as constants. Anyone can write, so each one caps how much a
stranger can store.

[http.ts:10-15](http.ts#L10-L15): the CORS headers. Rooms has the first
three; Rest needs more of each:

- `allow-methods` lists `PUT` and `DELETE`. Rooms could leave this as
  documentation, because GET and POST never need permission. `PUT` and
  `DELETE` do: the browser sends a preflight `OPTIONS` first and refuses
  to go on unless the reply lists the method. `PATCH` isn't listed, which
  is why the Browser page's **PATCH** button never reaches the server.
- `allow-headers: content-type` is needed for the same reason: a
  `content-type: application/json` body also triggers a preflight.
- `expose-headers` is new. A page on another origin can read only a few
  response headers. Without this line, `location` (after a `201`),
  `allow` (after a `405`) and `vary` would arrive, but the page's
  JavaScript would see `null`. See Browser's
  [CORS topic](https://github.com/backspaces/Browser/blob/main/CORS/README.md).

[http.ts:17-27](http.ts#L17-L27): create the table once per isolate.
Same pattern as Rooms, simpler: there's only one SQL statement, so
`sqlite.execute(...)` already returns the one Promise to share, with no
`(async () => { ... })()` wrapper. The `.catch` clears `ready` after a
failure so the next request tries again.

The table stores each item's data as text (`body`), not as columns. Rest
doesn't know or care what's inside an item, so the JSON goes in as a
string and comes out with `JSON.parse`. The dates are ISO strings
(`2026-10-04T23:17:21.186Z`), which sort correctly as text, so
`order by updated` and `updated < ?` work without a date type.

## Replies (lines 29–70)

[http.ts:30-45](http.ts#L30-L45): `about`, what `GET /` returns. A
plain object. The `${maxBody}` inside the backtick strings keeps the
description true if a limit changes. `items: "/items"` is a link, the
one starting point a client needs; everything after that comes from
following `url` fields.

[http.ts:47-48](http.ts#L47-L48): `escape()` makes text safe to put
inside HTML.

- `/[&<>]/g` matches any of the three characters, everywhere (`g` is
  "global": all matches, not just the first).
- When `replace` is given a function, it calls it for each match and
  uses what it returns. Here the function looks the character up in a
  small object: `({...})[c]`. The parentheses around the object are
  needed, or the `{` would be read as the start of a function body.
- Why it matters: an item's data could contain `<script>`. Escaped, it
  shows as text instead of running.

[http.ts:51-59](http.ts#L51-L59): `page()`, the HTML a browser tab
gets.

- One template string holds the whole page. `${ ... }` can hold any
  expression, even a multi-line one.
- `JSON.stringify(value, null, 2)` pretty-prints: the `2` means indent
  by two spaces. (The `null` is a slot for a filter function, unused.)
- The JSON is escaped first, then links are added, in that order. Done
  the other way, `escape` would break the `<a>` tags it just added.
- The regex `"(\/items(?:\/[\w-]+)?)"` finds quoted strings that are
  `/items` or `/items/<id>`. `( )` captures the path, `(?: )?` is an
  optional group that isn't captured, and `$1` in the replacement puts
  the captured path back in, twice: as the `href` and as the text.
- `<pre style="white-space: pre-wrap">` keeps the indentation but wraps
  long lines, so it fits on a phone.

[http.ts:63-70](http.ts#L63-L70): `reply()`. Every response except the
preflight comes from here, so the CORS headers, `vary` and the
JSON-or-HTML choice are made in exactly one place.

- `{ ...cors, vary: "accept", ...headers }`: later keys win, so a
  caller's extra headers (`location`, `allow`) are added last.
- `value === undefined` means "no body": the `204` after a `DELETE`.
  `new Response(null, ...)` sends no body at all.
- `req.headers.get("accept")?.includes("text/html")`: `?.` is optional
  chaining. If there's no `accept` header, `get` returns `null`, and
  `?.` stops there and gives `undefined` instead of throwing. A browser
  tab sends `text/html`; `fetch` and `curl` send `*/*`. This is content
  negotiation, and `vary: accept` tells caches the answer depends on it.
- The last line handles `HEAD`: same status and headers as `GET`, but
  `null` for the body. That's why `HEAD` needs no code of its own: its
  handlers just call the `GET` ones.

## Items (lines 72–117)

[http.ts:73-79](http.ts#L73-L79): `show()` turns a database row into
what clients see. Two changes from the row: `body` is parsed back into
`data`, and a `url` is added, so a client never has to build
`/items/` + id itself. The arrow function returns an object, so it's
wrapped in `( )`, for the same reason as in `escape`.

[http.ts:81-83](http.ts#L81-L83): `find()` returns one row, or
`undefined` if there's none (`rows[0]` of an empty list). The `?` in the
SQL is a placeholder filled from `args`. Never paste an id into the SQL
string itself: an id like `x' or '1'='1` would change the query. The
route only accepts `[\w-]` ids anyway, but the placeholder is the habit.

[http.ts:86-98](http.ts#L86-L98): `readBody()` checks a `POST` or `PUT`
body, cheapest check first.

- **`415`** if it isn't sent as JSON. `startsWith` rather than `===`
  because clients may add `; charset=utf-8`.
- **`413`** if it's too big. `text.length` would be wrong here: it
  counts UTF-16 code units, so `"é"` is 1 but takes 2 bytes, and an
  emoji is 2 but takes 4. `new TextEncoder().encode(text)` turns the
  string into its UTF-8 bytes, a `Uint8Array`, whose `length` is the
  real size. (Fixed 2026-10-07: 2100 `é`s now get `413`; before, they
  were stored at about 4.2 KB.)
- **`400`** if it doesn't parse. `catch {` with no `(e)` is allowed
  when the error itself isn't needed.

It returns one of two kinds of thing: `{ data }` if all is well, or a
finished `Response` to send back. The caller tells them apart with
`instanceof Response` (lines 137 and 150). That keeps the callers short:
check once, then go on.

[http.ts:101-117](http.ts#L101-L117): `store()`, shared by `POST` and
`PUT`. `old` is the item's current row, or `undefined` if it's new.

- The size limit applies only to new items (`if (!old)`), so a full
  collection can still be edited.
- One SQL statement creates or replaces: an **upsert**. `insert` tries
  to add the row. If the id already exists, `on conflict(id) do update`
  changes it instead, and `excluded.body` means "the value this insert
  tried to use". Only `body` and `updated` change, so `created` keeps
  its first value.
- The count and the insert are two separate requests to the database.
  Two requests arriving together when there are 499 items could both
  see 499 and both insert. For a 500 limit on throwaway data, a few over
  is harmless; a real limit would need a transaction.
- `old?.created ?? now`: optional chaining again, then `??` for "if
  that's missing, use `now`".
- The last line is the `PUT` rule: replacing gives `200`, creating gives
  `201` with a `location` header.

## Routing (lines 119–182)

[http.ts:121-160](http.ts#L121-L160): three objects, one per kind of
resource: `root` (`/`), `collection` (`/items`) and `item`
(`/items/<id>`). Each key is an HTTP method, and each value handles it.

- `async GET(req) { ... }` is method shorthand, the same as
  `GET: async function (req) { ... }`.
- `HEAD: (req) => collection.GET(req)` reuses `GET`; `reply()` drops
  the body.
- `POST` takes the first 8 characters of `crypto.randomUUID()` as the
  new id. `crypto` is built into Deno and browsers, no import needed.
  8 hex characters is about 4 billion possibilities, plenty for 500
  items.
- `PUT` passes `await find(id)` as `old`, so `store` knows whether this
  is a create or a replace.
- `DELETE` doesn't look the item up first. The database reports how many
  rows it deleted (`rowsAffected`): 1 means it was there (`204`), 0
  means it wasn't (`404`). One query instead of two.

[http.ts:162-167](http.ts#L162-L167): `route()`, the reason for
organizing handlers this way.

- `methods[req.method]` looks the handler up by name: `item["PUT"]`.
  Square brackets read a property whose name is in a variable.
- If there's none, the request named a real resource with the wrong
  method, which is `405`. `Object.keys(methods)` is the list of methods
  that would work, so the `allow` header can't drift out of step with
  the code: add a `PATCH` handler to `item` and it appears in `allow`
  by itself. (It would also need adding to the CORS
  `allow-methods`, by hand.)

[http.ts:169-182](http.ts#L169-L182): the entry point, called once per
request.

- `OPTIONS` (the preflight) is answered first, before touching the
  database: `204` with the CORS headers, whatever the path.
- `const { pathname } = new URL(req.url)`: destructuring takes just the
  path, without the host or `?query`.
- Expiry runs on every request, before answering. That keeps it simple,
  with no cron trigger, and means no client ever sees an expired item.
  Strictly, it makes every `GET` change the database, which a `GET`
  shouldn't do. But the change is housekeeping the client can't
  observe, not something the request asked for, which is the line REST
  cares about.
- Three paths, checked in order. The regex `^\/items\/([\w-]{1,64})$`
  matches the whole path (`^` to `$`), and captures the id: 1–64
  letters, digits, `_` or `-`. `match[1]` is the captured part.
- Anything else gets `404`. Note the difference: `/nope` is `404` (no
  such resource), while `DELETE /items` is `405` (it exists, but not
  for that).
