# Rooms

Fifth val: a shared message board that lets browsers talk to each other.
Every browser posts to a named room and polls for what others posted, so
everyone in a room sees the same messages in the same order. The val sits
in the middle of every exchange (a relay), rather than browsers talking
directly.

This is step 1 of two. Step 2 will use these same rooms to set up WebRTC,
so browsers can then send data straight to each other. WebRTC's setup
("signaling") is just a few messages addressed to one peer, and the `to`
field below already handles that. So step 2 should need a smarter client,
not new server code.

- `http.ts`: the API, plus a small chat page at `/` for testing.

## API

Rooms are created on first use. Names are 1–64 letters, digits, `_` or `-`.

- `POST /room/<name>` with JSON `{ from, data, to? }` adds a message.
  `from` is any id the client picks; `data` is any JSON (up to 16 KB for
  the whole body); `to` makes it private to one peer. Returns `{ id, time }`.
- `GET /room/<name>?since=<id>&me=<peer>` returns
  `{ messages, last, more }`: up to 100 messages with an id greater than
  `since`, oldest first. `messages` includes broadcasts, messages sent to
  `me`, and messages sent by `me`. Pass `last` back as the next `since`.
  If `more` is true, there's more to read, so ask again right away.

Each message comes back as `{ id, from, to, data, time }`. Ids increase
across all rooms, so they're only useful as a cursor, not as a count.

CORS is open (`*`), so a page served from anywhere (GitHub Pages, a
local file, another site) can use the API. The browser only needs the
URL; nobody has to visit val.town.

## Storage

One SQLite table, `messages`, indexed on `(room, id)`: the same private
per-val SQLite as [Mailbox](../Mailbox/). Each `POST` deletes messages
older than 24 hours, so there's no cleanup cron.

The table is created on the first request each isolate handles, not on
every request. If that setup fails, the failure is not remembered. The
very first deploy hit a `LibsqlError` HTTP 500 on `create index` (the same
transient hiccup Mailbox saw), and caching that failed attempt made every
later request fail too, until the code was changed to retry.

## Not secure (yet)

`from`, `to` and `me` are whatever the client says. Anyone can post as
anyone, and anyone who guesses a peer id can read "private" messages by
passing `me=<that id>`. That's fine for trying things out. If it matters
later: room keys (like the [Notes](../Notes/) password), or encrypting
`data` between peers.

## Trying it

Live at [backspaces-rooms.val.run](https://backspaces-rooms.val.run/)
(custom subdomain, like [Hello](../Hello/)).

Open the page in two tabs and chat. Add `?room=<name>` to use a room other
than `lobby`. Each tab gets its own peer id (kept in `sessionStorage`,
which is per tab). The page polls every second.

The input box is multi-line; Ctrl+Enter (⌘+Enter on a Mac) sends. If what
you type is valid JSON, it's sent as the message's `data` as-is and shown
pretty-printed; anything else is sent as `{ text }`. So a bare `42` or
`true` goes out as JSON, not text.

From the shell:

```sh
U=https://backspaces-rooms.val.run
curl -X POST -d '{"from":"alice","data":{"text":"hi all"}}' $U/room/test
curl -X POST -d '{"from":"alice","to":"bob","data":{"text":"psst"}}' $U/room/test
curl "$U/room/test?me=bob"    # both messages
curl "$U/room/test?me=carol"  # only "hi all"
```

Verified: broadcast and private delivery as above, `since` paging,
separate rooms, and the 400/404/413 errors for bad JSON, a missing
`from`, a bad room name and an oversized body.
