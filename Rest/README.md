# Rest

Ninth val: a small, textbook REST API. One collection, `/items`, of JSON
items that anyone can read, create, replace and delete. It exists to be
the server for the [Browser](https://github.com/backspaces/Browser)
repo's REST topic, so it follows the conventions closely where the other
vals bend them (see "Compared with the other vals" below).

- `http.ts`: the whole thing.
- `RestBreakdown.md`: a line-by-line walkthrough of `http.ts`, explaining
  the JavaScript.

## The API

| Request | Does | Replies |
| --- | --- | --- |
| `GET /` | describes the API | `200` |
| `GET /items` | the 100 most recently updated items | `200 {items: [...]}` |
| `POST /items` | adds an item; the server picks its id | `201`, `location: /items/<id>` |
| `GET /items/<id>` | reads one item | `200`, or `404` |
| `PUT /items/<id>` | creates or replaces the item with that id | `201` (created) or `200` (replaced) |
| `DELETE /items/<id>` | removes it | `204`, or `404` |
| `HEAD` on any GET URL | GET without the body | as GET |
| anything else on a real URL | | `405`, with an `allow` header listing what is allowed |

The body of `POST` and `PUT` is the item's data: any JSON, sent with
`content-type: application/json`. An item comes back as:

```json
{
  "id": "milk",
  "url": "/items/milk",
  "data": { "qty": 2 },
  "created": "2026-10-04T23:17:21.186Z",
  "updated": "2026-10-04T23:17:21.186Z"
}
```

Errors are JSON too, `{ "error": "..." }`, with an honest status:
`400` bad JSON, `404` no such item, `405` wrong method, `413` over 4 KB,
`415` not sent as JSON, `507` the collection is full.

```sh
URL=https://backspaces-rest.val.run
curl -i -X PUT $URL/items/milk -H content-type:application/json -d '{"qty":2}'
curl $URL/items/milk
curl -i -X DELETE $URL/items/milk
```

## The textbook parts

- **URLs name things; methods say what to do.** `/items` is the
  collection, `/items/milk` one item in it.
- **`PUT` versus `POST`.** `PUT` says "make the item at this URL equal to
  this", so sending it twice leaves the same result: it's safe to retry.
  `POST` says "add this to the collection" and the server picks the id,
  so sending it twice makes two items.
- **`201 Created` with `location`.** After a `POST`, the `location` header
  says where the new item lives. The item's own `url` field says the same
  thing, so a client can follow links rather than build URLs.
- **`204 No Content`** after a `DELETE`: success, nothing to say.
- **`405` with `allow`.** The reply says which methods would work. Each
  resource's handlers are an object keyed by method (`root`,
  `collection`, `item`), and the `allow` header is just its keys.
- **One URL, two formats.** A request whose `accept` header includes
  `text/html` (a browser visit) gets the JSON as a page, with its links
  clickable. Anything else (`fetch`, `curl`) gets JSON. The reply carries
  `vary: accept`, which tells caches the answer depends on that header.
- **Stateless.** Each request carries everything needed to answer it.
  Nothing about a client is remembered between requests.

## CORS

Open, as with Rooms, but more of it is needed:

- `access-control-allow-methods` includes `PUT` and `DELETE`. Those, and
  any JSON body, make the browser send a **preflight** `OPTIONS` first,
  which gets a `204` with the CORS headers.
- `access-control-expose-headers: location, allow, vary`. Without it, a
  page on another origin can't read `location` after a `POST` (or `allow`
  after a `405`), even though the header arrived. CORS hides all but a
  few response headers unless the server lists them.

## Limits

Anyone with the URL can write, so:

- an item is at most 4 KB of JSON (counted in UTF-8 bytes, not
  characters);
- items not updated for 24 hours are deleted (on every request, before
  answering);
- the collection holds at most 500 items. Past that, creating gets `507`
  until old ones expire. Replacing an existing item still works.

There's no password, unlike Notes: the data is throwaway by design.

## Compared with the other vals

| Val | Bends the convention by... |
| --- | --- |
| Notes | saving with `POST /<name>` where REST would use `PUT`; no `DELETE`; plain-text replies |
| Rooms | nothing much: `POST` adds a message, `GET` reads them. No `HEAD`, no `PUT`/`DELETE`, because messages are never changed |
| Watch | choosing JSON with `?json` rather than `accept`; `?check` makes a GET do something (rate-limited) |
| Mcp | not REST at all: JSON-RPC, one URL, the action named in the body |

## Setting it up

`vt create` refuses a description over 64 characters (and creates
nothing). As with [Mcp](../Mcp/README.md#setting-it-up), the val was
created empty elsewhere (`vt create Rest <scratch dir>`), its `.vt/`
moved into `Rest/`, and then `vt push`.

Endpoint (subdomain claimed): `https://backspaces-rest.val.run/`. The
default one, `https://backspaces--a14305aac04911f1bc371607ee4eb77e.web.val.run`,
also still works.

## Verified

Against the deployed val (2026-10-04), with `curl`: every row of the API
table, including `201` with `location` for both `POST` and a new `PUT`,
`200` for a replacing `PUT`, `204` then `404` for a repeated `DELETE`,
`405` with `allow: GET, HEAD, POST` for `DELETE /items`, `415`, `400`,
an empty body for `HEAD`, HTML for `accept: text/html`, and a preflight
for `PUT` answered with the CORS headers.

And in a browser (headless Chrome, driving the Browser repo's REST page
from a `file://` origin): every preset button gave the status and
verdict the page describes, the `location` button followed a `201`
through to a `200`, `PATCH` was refused at the preflight, and the
collection panel tracked each change.

Later (2026-10-07): the 4 KB limit now counts UTF-8 bytes (2100 `é`s,
4.2 KB, get `413`; 1000 get `201`), and [Watch](../Watch/) checks Rest
every 15 minutes (`GET /items`), first check up.
