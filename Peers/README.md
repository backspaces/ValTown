# Peers

Sixth val: browsers sending data straight to each other over WebRTC,
using [Rooms](../Rooms/) only to introduce them. Step 2 of the two-step
plan in the Rooms README.

- `peers.js`: the reusable part, a browser module any page can import.
- `index.html`: a demo page with a peer list, shared cursors and chat.
- `http.ts`: serves those two files, nothing else.

Deliberately a separate val from Rooms. It calls Rooms from another
origin, which is exactly how any outside page would use it, so this
exercises Rooms' open CORS for real. It also keeps the tested relay
untouched while this side gets experimented on. Rooms needed no changes.

## Using it

```js
import { join } from "https://backspaces-peers.val.run/peers.js";
const room = await join("lobby");
room.onMessage((data, from) => console.log(from, data));
room.onPeers((peers) => console.log([...peers.values()]));
room.send({ hello: "everyone" });
room.send({ hello: "you" }, { to: "peer-abc123" });
room.send({ x: 1 }, { directOnly: true }); // skip peers without a direct link
```

`room.peers` maps each peer id to `{ id, state }`, where `state` is
`connecting`, `direct` or `relay`. Options for `join`: `server` (another
Rooms deployment), `id` (instead of a random `peer-xxxxxx`), `rtc` (an
`RTCPeerConnection` config, for example to add TURN servers).

## How a browser joins

WebRTC can't connect two browsers until each knows the other's
connection details. Trading those is called signaling, and it's all
done through ordinary Rooms messages:

1. **Hello.** The newcomer broadcasts `hello`. It starts reading the room
   from its own hello onward, so old hellos and offers from earlier
   visitors are skipped without any server change.
2. **Welcome.** Everyone already there replies `welcome`, addressed (`to`)
   to the newcomer alone, so it learns who's present.
3. **Offer and answer.** For each pair, the lower id calls: it creates the
   connection and a data channel and sends an `offer`; the other side
   replies with an `answer`. Letting only one side call avoids "glare",
   where both call at once.
4. **Addresses.** Each side asks Google's free STUN server
   (`stun.l.google.com:19302`) for its public address. Rather than send
   each address as it's found ("trickle ICE"), `peers.js` waits for them
   (up to 3 seconds) and includes them all in the offer or answer. With
   1-second polling, fewer messages is faster.
5. **Direct.** The data channel opens, and from then on messages go
   browser to browser without touching val.town.

Every browser connects to every other one. That's fine up to roughly 8–10
people; beyond that the number of links gets too large.

## When a direct link isn't possible

Some networks (corporate firewalls, some mobile carriers) block direct
connections unless there's a TURN server to relay the traffic, and those
cost money. If a pair isn't connected within 15 seconds, or the connection
fails before it ever opens, that peer becomes `relay`, and `send` posts its
messages through Rooms instead (1–2 seconds rather than milliseconds).

The demo only sends cursors over direct links (`directOnly`), since 30
updates a second is far too much for the relay. Chat goes everywhere.

## Leaving

Closing a tab sends a `bye` through Rooms with `navigator.sendBeacon`,
which still goes out while the page is closing. A direct link that closes
or fails also removes the peer. A relay peer that vanishes without a bye
(a crash, a dead laptop) stays in the list; there's no heartbeat yet.

## Serving files

`http.ts` returns `index.html` and `peers.js` as real files rather than
strings inside the code. Every file in a public val is published on
esm.town, so it reads them back with
`fetch(new URL(name, import.meta.url))`. They come back unchanged; a
`diff` of each served file against the local copy was empty.

## Trying it

Live at [backspaces-peers.val.run](https://backspaces-peers.val.run/)
(custom subdomain, like [Hello](../Hello/)).

Open the page in several tabs or browsers. Add `?room=<name>` for a
different room, and `?relay` to block direct links, so that peer shows
how the relay fallback behaves.

Verified with headless Chrome (three separate browser profiles):
- All three connected directly within about 8 seconds, including browser
  startup.
- Chat and cursors arrived over the direct links.
- Closing one tab removed it from the other two.
- With `?relay`, two tabs switched to `relay` after the 15-second timeout,
  chat still arrived, and closing one removed it from the other through
  the `bye` message.

Also tried by hand: an incognito window, closing a window (the others
logged it as "left"), and a second machine, all connecting directly.
