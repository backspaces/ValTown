# Peers, line by line

A walkthrough of Peers' three code files, explaining the JavaScript as it
goes. [README.md](README.md) says what Peers does and how WebRTC signaling
works; this file says how the code does it. It builds on
[RoomsBreakdown.md](../Rooms/RoomsBreakdown.md): ideas explained there
(arrow functions, destructuring, `??`, the polling loop) are only pointed
to here.

The three files, in the order a visit uses them:

1. **[http.ts](http.ts)** (18 lines) runs on val.town. It serves the other
   two files.
2. **[peers.js](peers.js)** (202 lines) runs in the browser. It's the
   reusable part: any page can import it.
3. **[index.html](index.html)** is the demo page. Its script (lines 36–137)
   imports `peers.js` and builds the peer list, cursors and chat on top.

## http.ts: serving two files

[http.ts:4-7](http.ts#L4-L7): a lookup table from URL path to file.

```js
const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/peers.js': ['peers.js', 'text/javascript; charset=utf-8'],
}
```

An object used as a table: keys are paths, values are two-element arrays
of file name and content type. It replaces a chain of `if` statements, and
adding a file is one more line.

[http.ts:10-12](http.ts#L10-L12)

- `files[new URL(req.url).pathname]` looks up the path. Any path not in
  the table gives `undefined`, hence the 404 on line 11.
- `const [name, type] = entry` is **array destructuring**: the first
  element goes into `name`, the second into `type`. Same idea as object
  destructuring, but by position rather than by name.

[http.ts:13](http.ts#L13): `fetch(new URL(name, import.meta.url))`

- **`import.meta.url`** is the URL of this module itself. On val.town
  it's something like `https://esm.town/v/backspaces/Peers@9-main/http.ts`.
  Every file in a public val is published at such an address.
- `new URL(name, base)` resolves a relative name against a base URL, the
  way a browser resolves a link. `peers.js` against that base becomes
  `https://esm.town/v/backspaces/Peers@9-main/peers.js`.
- So the server fetches its own sibling file. Because the base includes
  the version (`@9`), it always gets the files from the same deploy as
  itself.
- It fetches again on every request, with no caching. That's fine for a
  demo; a module-level variable, as Rooms uses for `ready`, could keep the
  text after the first read.

[http.ts:14](http.ts#L14): `res.ok` is true for any 2xx status. If
esm.town fails, the reply is `502`, HTTP's "bad gateway": the server
itself is fine, but something it depends on failed.

[http.ts:15-17](http.ts#L15-L17): send the text on with our own headers.

- **The content type matters.** It tells the browser what the bytes
  are. esm.town serves `index.html` as `application/octet-stream`
  (unknown binary data), so passing its headers through would make the
  browser download the page instead of showing it. `peers.js` comes back
  as `application/javascript`, which would work, but browsers refuse to
  run a module script served as anything other than JavaScript. So the
  server doesn't pass esm.town's headers through. It sets each type from
  the table.
- `access-control-allow-origin: *` lets pages on other sites import
  `peers.js`. Module scripts from another origin follow CORS rules, so
  without this header, `import ... from 'https://backspaces-peers.val.run/peers.js'`
  would fail everywhere except on the Peers page itself.

## peers.js: the module

### The whole shape

Everything except a few constants lives inside one function, `join()`:

```js
export async function join(roomName, options) {
    const peers = new Map()   // private state...
    let since = 0
    function addPeer() { ... }   // ...private helpers that share it...
    // ...
    return { id: me, peers, send, leave, onMessage, onPeers }   // ...and a few chosen to share
}
```

- Every function defined inside `join` can see and change `join`'s
  variables, even after `join` has returned. This is a **closure**: an
  inner function keeps access to the variables around it for as long as
  the function itself exists.
- The returned object is the public part. Everything else is private:
  other code can't reach `since` or `addPeer` at all.
- Each call to `join` gets a fresh set of variables, so a page could join
  two rooms at once without them mixing.
- A `class` could do the same job, with `this.peers`, `this.since` and
  methods. The closure version needs no `this`, and nothing private can
  be reached from outside.

### Settings (lines 1–21)

[peers.js:1-15](peers.js#L1-L15): the usage comment. It's the
documentation someone importing the module will read.

[peers.js:17-21](peers.js#L17-L21): constants outside `join`, shared by
every room.

- `rtcConfig` is the default WebRTC setup: where to find a STUN server,
  which tells a browser its public address.
- The three times are in milliseconds, like everything in JavaScript's
  timers.

### `join`'s parameters and state (lines 23–33)

[peers.js:23-26](peers.js#L23-L26)

```js
export async function join(
    roomName,
    { server = defaultServer, id, rtc = rtcConfig } = {},
) {
```

- `export` makes `join` importable. It's the only thing the module
  exports.
- `async` means `join` returns a Promise. Callers write
  `const room = await join('bath')` and wait until the hello has been
  posted.
- The second parameter is **destructured with defaults**: callers pass an
  options object, and each option falls back to its default if left out.
  The final `= {}` makes the whole object optional, so `join('bath')`
  works. Without it, destructuring `undefined` would throw.
- Defaults apply only to `undefined`, not `null`. That's why the demo page
  passes `rtc: undefined` when it wants the default.

[peers.js:27-33](peers.js#L27-L33)

- `id ?? 'peer-' + ...` uses the caller's id if one was given, otherwise
  a random one, made the same way as in Rooms but six characters long.
- `` `${server}/room/${roomName}` `` is a template literal with
  placeholders: each `${...}` is replaced by the value inside.
- **`new Map()`** holds the peers, keyed by peer id. A `Map` is like a
  plain object used as a table, but built for it: `.get`, `.set`, `.has`,
  `.delete`, a `.size`, and it iterates in the order entries were added.
- `messageFns` and `peerFns` are lists of callback functions, explained
  under "Telling the page" below.
- `stopped` becomes true after `leave()`, and ends the polling loop.

### Talking to Rooms (lines 35–40)

[peers.js:35-40](peers.js#L35-L40): `post(data, to)` sends one message to
the room.

- It's the same `fetch` POST as the Rooms test page, written with
  `.then((res) => res.json())` instead of `await`. `.then` attaches a
  function to run when the Promise finishes, and returns a new Promise for
  its result. So `post` returns a Promise of the server's parsed reply.
- For a broadcast, `to` is `undefined`, and `JSON.stringify` leaves out
  keys whose value is `undefined`. The body has no `to` at all, which is
  what Rooms treats as "everyone".

### Telling the page (lines 42–49)

[peers.js:42-43](peers.js#L42-L43)

```js
const changed = () => peerFns.forEach((fn) => fn(peers))
const deliver = (data, from) => messageFns.forEach((fn) => fn(data, from))
```

- The page registers functions with `room.onMessage(fn)` and
  `room.onPeers(fn)` (lines 199–200), which push them onto these lists.
  `deliver` and `changed` call every function on the list.
- This is the **observer** pattern: `peers.js` doesn't know or care what
  the page does with a message. It just tells whoever asked.
- DOM events work the same way (`addEventListener` keeps a list of
  handlers); this is a hand-made version.

[peers.js:45-49](peers.js#L45-L49): `setState` changes a peer's state and
announces it, but returns early if nothing changed. So the page redraws
only on real changes.

### Keeping track of peers (lines 51–69)

[peers.js:51-60](peers.js#L51-L60): `addPeer(peerId)`

- If the peer is already known, it returns the existing one, so calling
  it twice is harmless.
- `const peer = { id: peerId, state: 'connecting' }`: each peer is a
  plain object. More properties get added to it later (`timer`, `pc`,
  `channel`). JavaScript objects are open: you can add a property at any
  time just by assigning to it.
- **The timeout:** `setTimeout` schedules a function for 15 seconds from
  now and returns an id, kept as `peer.timer` so it can be cancelled. If
  the peer is still `connecting` when it fires, it becomes `relay`.

[peers.js:62-69](peers.js#L62-L69): `removePeer(peerId)`

- `clearTimeout(peer.timer)` cancels the pending timeout, if any.
- **`peer.pc?.close()`** is optional chaining: call `close()` only if
  `peer.pc` exists. A peer that never got as far as a connection has no
  `pc`, and plain `peer.pc.close()` would throw.

### WebRTC connections (lines 71–96)

[peers.js:71-82](peers.js#L71-L82): `newConnection(peer)`

- **`new RTCPeerConnection(rtc)`** is the browser's WebRTC object for one
  connection to one other browser. A peer with a direct link has one of
  these.
- `pc.onconnectionstatechange` runs whenever `pc.connectionState` changes.
  The states go `new`, `connecting`, `connected`, and possibly
  `disconnected`, `failed` or `closed`.
- Only `failed` matters here, and it means two different things depending
  on history: after the link worked, the other side left; before it ever
  worked, our networks can't connect directly, so fall back to the relay.

[peers.js:84-96](peers.js#L84-L96): `useChannel(peer, channel)` wires up
an **`RTCDataChannel`**, the pipe that actually carries messages. A
connection can carry audio and video too; a data channel carries
arbitrary text or binary data.

- `onopen`: the direct link works. Cancel the relay timeout and mark the
  peer `direct`.
- `onclose`: the channel closed. `peers.get(peer.id) === peer` checks this
  is still the same peer object, not one already removed. `===` on objects
  compares identity (the same object), not contents.
- `onmessage`: `e.data` is the text the other side sent. It was
  `JSON.stringify`'d on the way out (line 172), so `JSON.parse` turns it
  back into data before delivering it.

### Turning an event into a Promise (lines 98–110)

[peers.js:101-110](peers.js#L101-L110)

```js
async function localDescription(pc) {
    await new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve()
        pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') resolve()
        })
        setTimeout(resolve, gatherTimeoutMs)
    })
    return pc.localDescription
}
```

The browser finds its network addresses ("ICE candidates") in the
background and announces progress with events, not a Promise. This
function wraps those events in a Promise so the rest of the code can just
`await` it.

- **`new Promise((resolve) => { ... })`** makes a Promise by hand. The
  function inside runs immediately and receives `resolve`. The Promise
  finishes when something calls `resolve()`.
- Three ways to finish: gathering was already complete, the
  `icegatheringstatechange` event reports it complete, or 3 seconds pass.
  Whichever happens first wins; calling `resolve` again later does
  nothing.
- **`pc.localDescription`** is then this side's description, in a text
  format called SDP (Session Description Protocol). It lists what the
  connection will carry, the addresses to try, and the keys for its
  encryption. It's what gets posted to the other peer.

### Calling and answering (lines 112–125)

[peers.js:112-117](peers.js#L112-L117): `call(peer)`, run by the side with
the lower id.

- The data channel is created **before** the offer. The offer describes
  everything the connection will carry, so the channel has to exist first
  to be included.
- `await pc.setLocalDescription(await pc.createOffer())`: inner `await`s
  run first. Create the offer, then adopt it as this side's description.
- `post({ type: 'offer', sdp: await localDescription(pc) }, peer.id)`:
  wait for the addresses, then send the whole description to that one
  peer.

[peers.js:119-125](peers.js#L119-L125): `answer(peer, sdp)`, the other
side.

- `pc.ondatachannel` fires when the caller's channel arrives. This side
  doesn't create a channel; it receives the one the caller made.
- `setRemoteDescription(sdp)` takes in the caller's offer, then
  `createAnswer` and `setLocalDescription` make and adopt a reply, which
  is posted back.
- When the caller gets that answer, line 144 passes it to
  `setRemoteDescription`. Now both sides know both descriptions, and the
  browsers connect on their own.

### Handling Rooms messages (lines 127–150)

[peers.js:130](peers.js#L130): `async function handle({ from, data: msg })`

- Destructuring in the parameter list, with a rename: the message's
  `data` field arrives as a variable called `msg`, to avoid confusion with
  the app data carried inside `data` messages.

[peers.js:132-149](peers.js#L132-L149): a **`switch`** on the message
type. It compares `msg.type` against each `case` in turn and runs the
first match.

- **`case 'hello': case 'welcome':`** with nothing between them makes both
  types run the same block. `switch` "falls through" from one case to the
  next until something stops it, here the `return`.
- That block has its own `{ braces }`. All the cases of a `switch` share
  one scope, so without braces, a `const peer` in one case would clash
  with a `const` of the same name in another.
- **`if (me < from)`** compares the two ids as strings, alphabetically.
  Both sides compute the same answer, so exactly one of each pair calls.
  Any rule both sides agree on would work.
- The other cases each `return` a function's result. In an `async`
  function, returning a Promise means that Promise's failure becomes this
  function's failure, so the `.catch` on line 159 sees it.
- There's no `default:` case. Unknown message types are ignored.

### The polling loop (lines 152–166)

[peers.js:152-166](peers.js#L152-L166): the same loop as the Rooms test
page, with two differences.

- `if (stopped) return` ends it after `leave()`.
- **`handle(m).catch(...)` isn't awaited.** Each message is handled
  concurrently, and the loop moves straight on. That matters because
  handling a `hello` can take 3 seconds (gathering addresses for the
  offer). If the loop awaited each one, it would stall polling for that
  long. `.catch` still logs any failure, since nobody else would see it.

### Sending (lines 168–177)

[peers.js:168-177](peers.js#L168-L177): `send(data, { to, directOnly })`

```js
const targets = to ? [peers.get(to)].filter(Boolean) : [...peers.values()]
```

- With `to`: `[peers.get(to)]` is a one-element array, holding
  `undefined` if that peer isn't known. **`.filter(Boolean)`** keeps only
  truthy elements (`Boolean` is used as the test function), so the result
  is `[peer]` or `[]`. The loop below then works either way.
- Without `to`: `[...peers.values()]` copies all the peers into an array.
  `peers.values()` is an iterator, a one-pass sequence rather than an
  array, and spreading it into `[...]` makes a real array.
- For each target: send over the data channel if it's `open`, otherwise
  post through Rooms, unless `directOnly` says not to bother.
- `channel.send` takes a string, hence `JSON.stringify`.

### Leaving (lines 179–186)

[peers.js:179-186](peers.js#L179-L186)

- **`navigator.sendBeacon(url, body)`** is a POST made for pages that are
  closing. A normal `fetch` can be cancelled when the page goes away; a
  beacon is handed to the browser to deliver regardless. Its body is a
  plain string, which makes it a "simple" request with no CORS preflight,
  and it can't read the reply, so there's nothing to wait for.
- `[...peers.keys()]` copies the ids into an array before the loop,
  because `removePeer` deletes from the map while the loop runs.
- **`addEventListener('pagehide', leave)`**: `pagehide` fires when the page
  is closed, reloaded or navigated away from. It's more dependable than
  the older `unload` event, particularly on phones.

### Starting up (lines 188–201)

[peers.js:190-192](peers.js#L190-L192)

- `await post({ type: 'hello' })` announces this browser and waits for
  Rooms' reply, `{ id, time }`.
- `since = hello.id` starts reading **after** our own hello, so the room's
  older messages (yesterday's hellos and offers) are skipped.
- `poll()` starts the loop, not awaited: it runs until `leave()`.

[peers.js:194-201](peers.js#L194-L201): the public object.

- `id: me` renames on the way out: the page sees `room.id`.
- `peers, send, leave` are shorthand properties.
- `peers` is the live `Map` itself, not a copy, so the page always sees
  current states. (The page should only read it.)
- `onMessage: (fn) => messageFns.push(fn)` registers a callback.

## index.html: the demo page's script

The page is a real `.html` file here, not a string inside the server as
in Rooms. So its script can use backticks and `${...}` freely.

### Joining (lines 36–46)

[index.html:36-37](index.html#L36-L37)

```js
import { join } from './peers.js'
```

- Only a `type="module"` script can `import`.
- `./peers.js` is relative to the page's own URL, so it loads
  `https://backspaces-peers.val.run/peers.js`, which http.ts serves.

[index.html:39-44](index.html#L39-L44)

- `params.has('relay')` is true for `?relay` even with no value after it.
- `iceServers: []` and `iceTransportPolicy: 'relay'` together leave WebRTC
  no way to connect: it may only use relay servers, and there are none.
  So every link times out into the Rooms relay.
- Otherwise `rtc` is `undefined`, and `join` uses its default.

[index.html:45](index.html#L45): `const room = await join(roomName, { rtc })`

- **Top-level `await`**: an `await` outside any function. Only module
  scripts allow it. The rest of the script waits until `join` has posted
  the hello.

### Helpers (lines 48–58)

[index.html:48](index.html#L48): `$` is a shorthand for
`getElementById`. It's a `const`, so it can't be used before this line
runs, which is why lines 41 and 46 spell out `document.getElementById`.
A `function` declaration would be usable earlier; a `const` isn't.

[index.html:49-50](index.html#L49-L50): a color for each peer.

```js
const hue = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)
const color = (id) => `hsl(${hue(id)} 70% 45%)`
```

- `[...id]` spreads a string into an array of its characters.
- **`reduce`** walks an array carrying one running value, here `h`,
  starting at `0`. For each character `c`, it multiplies by 31, adds the
  character's code number, and wraps with `% 360` (remainder after
  dividing by 360). The result is a number from 0 to 359 that depends on
  every character.
- That number is a hue on the color wheel, and `hsl(hue saturation
  lightness)` is a CSS color. The same id always gives the same color, so
  every screen shows a peer in the same color without anyone sending it.

[index.html:52-58](index.html#L52-L58): `log(text, className)` adds a
line to the log, the same way as Rooms' `show`. `className = ''` is a
default parameter, used for plain chat lines.

### The peer list (lines 60–83)

[index.html:61-82](index.html#L61-L82): `room.onPeers(...)` registers a
function that runs on every change.

- `known` is this page's own memory of each peer's last state. Comparing
  it with the current states finds what changed, so the log reports each
  change once.
- `for (const [id, peer] of peers)` loops over a `Map`. Each entry is a
  `[key, value]` pair, destructured into two variables.
- The second loop finds peers that have gone: in `known` but no longer in
  `peers`. `continue` skips to the next id. Deleting from a `Map` while
  looping over it is allowed.
- `cursors.get(id)?.remove()` removes that peer's cursor, if it ever had
  one. `cursors` is declared further down (line 87), but this callback only
  runs later, after that line has run.
- **`$('peers').replaceChildren(...array)`** swaps all the badges for new
  ones in one step. `...` here spreads the array into separate arguments,
  because `replaceChildren` takes each child as its own argument.
- `span.className = peer.state` gives the badge the class `direct`,
  `relay` or `connecting`, which the CSS colors green, yellow or grey.

### Cursors (lines 85–117)

[index.html:89-97](index.html#L89-L97): sending your cursor.

- **Pointer events** (`onpointermove`, `onpointerleave`) cover mouse,
  touch and pen alike. On a phone, dragging a finger in the box moves your
  cursor. The CSS `touch-action: none` on the box (line 16) stops that drag
  from scrolling the page instead.
- **Throttling:** `performance.now()` is milliseconds since the page
  loaded, very precise and never going backwards. Anything within 33 ms
  of the last send is dropped, which caps sending at about 30 a second.
  Mice report far more often than that.
- `getBoundingClientRect()` gives the box's position and size on screen.
  Subtracting its left edge and dividing by its width gives `x` from 0 to
  1, and the same for `y`. Sending fractions rather than pixels means the
  cursor lands in the same relative spot on a phone and a laptop.
- `{ type: 'cursor', x, y }` uses shorthand properties.
- `{ directOnly: true }` keeps cursors off the relay.

[index.html:98](index.html#L98): leaving the box sends `x: null`, which
hides your cursor on other screens.

[index.html:100-117](index.html#L100-L117): `moveCursor(id, x, y)` shows
someone else's cursor.

- The first time a peer's cursor arrives, it makes a dot with a label and
  keeps it in the `cursors` map. After that it reuses it.
- `el.hidden = x === null` assigns the result of a comparison, `true` or
  `false`.
- `el.style.left = x * 100 + '%'` turns the fraction back into a position
  within the box. The CSS on `.cursor` (line 19) positions it absolutely,
  and `transform: translate(-50%, -50%)` centers the dot on that point
  rather than putting its corner there.

### Receiving and chat (lines 119–136)

[index.html:119-122](index.html#L119-L122): one `onMessage` handler for
all app messages, choosing by `data.type`. The `type` field is this
page's own convention; `peers.js` delivers any data unchanged.

[index.html:125-136](index.html#L125-L136): chat, the same as Rooms' with
two differences.

- `room.send(...)` rather than `fetch`: it goes over the direct links
  where they exist, and through Rooms where they don't.
- The page logs your own message immediately. With no server in the
  middle, nothing echoes it back as Rooms does.
- The handler isn't `async`, because `send` doesn't return anything to
  wait for.
