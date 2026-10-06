# Mcp, line by line

A walkthrough of [http.ts](http.ts), explaining the JavaScript as it
goes. [README.md](README.md) says what Mcp does and how to connect to it;
this file says how the code does it. It builds on
[RoomsBreakdown.md](../Rooms/RoomsBreakdown.md) and
[PeersBreakdown.md](../Peers/PeersBreakdown.md): ideas explained there
(arrow functions, destructuring, spread, `??`, the ternary) are only
pointed to here.

`http.ts` (166 lines) has three parts:

1. **Settings and helpers** (lines 1–41): URLs, a shared schema, tool
   hints, and three small functions every tool uses.
2. **The server** (lines 43–127): one `registerTool` call per tool.
3. **The entry point** (lines 129–166): what val.town calls for each
   request.

Most of the work, though, is done by the SDK, so it helps to see first
what actually goes over the wire.

## One call, start to finish

When you ask Claude "is everything up?", Claude Code sends this to
`https://backspaces-mcp.val.run/`:

```http
POST / HTTP/1.1
content-type: application/json
accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"watch_status","arguments":{}}}
```

and gets back:

```
event: message
data: {"result":{"content":[{"type":"text","text":"Last checked 2026-10-04T21:15:01.664Z\nRooms: up since 2026-10-01T23:30:04.714Z\nPeers: up since 2026-10-02T21:54:35.604Z"}]},"jsonrpc":"2.0","id":1}
```

- **JSON-RPC** is a tiny convention for calling a function over a
  network: a `method` name, its `params`, and an `id` so the reply can be
  matched to the request. MCP is a set of JSON-RPC methods:
  `initialize`, `tools/list`, `tools/call` and a few others.
- **The reply is server-sent events** (SSE): lines of `event:` and
  `data:`, ending in a blank line. SSE lets a server send several
  messages down one response, which matters for long-running tools that
  report progress. Ours always send exactly one.
- Before any call, the client sends `initialize` (which version of MCP,
  what each side supports) and `tools/list` (the tools, their
  descriptions and argument schemas). That's how Claude knows
  `watch_status` exists and what it's for.

The path through the code: val.town calls the function exported on
line 162, which hands the request to `handler.fetch` (line 166). The SDK
parses the JSON-RPC, builds a server with the factory on line 43, finds
the tool, checks the arguments against its schema, runs it, and writes
the result as SSE. The code in this file is only the tools themselves.

## Imports (lines 1–7)

[http.ts:3-6](http.ts#L3-L6)

```js
import {
  createMcpHandler,
  McpServer,
} from "npm:@modelcontextprotocol/server@2";
```

- **`npm:`** tells Deno (which val.town runs on) to fetch the package
  from npm. There's no `package.json` or `npm install`: the import itself
  says what to get, and `@2` pins the major version.
- `@modelcontextprotocol/server` is the official MCP SDK's server half.
  These are two of its exports: a class for the server, and a function
  that turns it into something that answers HTTP requests.

[http.ts:7](http.ts#L7): `import * as z from "npm:zod@4/v4"`

- **`import * as z`** is a namespace import: everything the module
  exports, gathered into one object called `z`. So `z.string()`,
  `z.object()` and so on.
- [zod](https://zod.dev/) describes the shape data should have, and
  checks data against it. `/v4` is a path inside the package, choosing
  zod's version 4 interface, which is the one this SDK expects.

## Settings (lines 9–14)

[http.ts:9-12](http.ts#L9-L12): the three vals' public URLs, and a
timeout.

- These are the same URLs a browser would use. Mcp has no special access
  to the other vals: it's just another client of theirs.
- `10_000` is `10000`. **Underscores in numbers** are only for reading;
  JavaScript ignores them.

[http.ts:13-14](http.ts#L13-L14): a zod schema for a room name, used by
two tools.

```js
const roomName = z.string().regex(/^[\w-]{1,64}$/)
  .describe('Room name: letters, digits, "_" or "-", e.g. "rooms"');
```

- **Method chaining:** each method returns a new schema with one more
  rule, so they're written one after another. Read it as "a string,
  matching this pattern, described like this".
- The regular expression is the same rule Rooms uses for its room names
  (see [RoomsBreakdown.md](../Rooms/RoomsBreakdown.md), "route matching"),
  plus `^` and `$`, which anchor it to the start and end so the *whole*
  string must match. Rooms would reject anything else anyway; checking
  here means Claude gets a clear error instead of a 404.
- **`.describe(...)` is for the model.** The SDK turns each schema into
  JSON Schema for `tools/list`, and the description goes with it. It's
  the only help Claude gets in choosing what to pass.

## Tool hints (lines 16–19)

[http.ts:18-19](http.ts#L18-L19)

```js
const readOnly = { readOnlyHint: true };
const addsOnly = { readOnlyHint: false, destructiveHint: false };
```

MCP calls these **annotations**: optional hints, sent with each tool in
`tools/list`, that say what kind of thing a tool does. They're aimed at
the app (claude.ai, Claude Code), not the model: the app can use them to
group tools or decide which need your OK.

- `readOnlyHint: true`: the tool only reads. Four tools use `readOnly`.
- `destructiveHint: false`: the tool changes something, but only by
  adding. `post_to_room` adds a message and never deletes or overwrites
  one. Without it, MCP's default is to assume a tool that isn't read-only
  might be destructive.
- They're *hints*: the SDK sends them as written and checks nothing. The
  spec tells clients not to trust them from servers they don't trust,
  since nothing stops a server from labelling a deleting tool "read-only".

## Helpers (lines 21–41)

### Tool results (lines 21–22)

[http.ts:21-22](http.ts#L21-L22)

```js
const text = (s) => ({ content: [{ type: "text", text: s }] });
const failed = (s) => ({ ...text(s), isError: true });
```

- MCP's tool result is an object with a `content` array, because a
  tool can return several pieces, including images. Every tool here
  returns one piece of text, so `text` builds that shape from a string.
- The parentheses around `{ ... }` make the arrow function return an
  object, rather than starting a function body (see RoomsBreakdown,
  "GET").
- `failed` is the same thing plus `isError: true`, built by **spreading**
  `text(s)` into a new object and adding one key.
- `isError` tells Claude the tool ran but didn't succeed. It's still an
  ordinary result, so Claude reads the text and can explain it, or try
  again differently.

### Calling another val (lines 24–31)

[http.ts:26](http.ts#L26): `async function call(url, init = {})`

- `init` is `fetch`'s second argument (method, headers, body). **`= {}`
  is a default parameter**: GET-only callers leave it out, and it's an
  empty object rather than `undefined`, so the spread on the next line
  works.

[http.ts:27](http.ts#L27)

```js
const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
```

- Copies the caller's options and adds one: a `signal`.
- **`AbortSignal.timeout(ms)`** makes a signal that fires after that
  long. `fetch` watches its signal, and when it fires, abandons the
  request and throws. Without it, a val that hangs would hang this tool,
  and Claude, with it. Ten seconds is generous for vals that normally
  answer in well under one.

[http.ts:28-30](http.ts#L28-L30): three outcomes.

- **404 returns `null`.** "No such note" is a normal answer, not a
  failure, so it's left to each tool to say so in its own words
  (`read_note` does, on line 60).
- **Any other non-2xx throws.** `res.ok` is true for any 2xx status. The
  error message includes the URL, the status and the body, because that
  message is exactly what Claude will see (via `safely`, below).
- **Otherwise the response is returned unread**, so each tool can read it
  as text or as JSON.

The other tools don't check for `null`. They call URLs that always
exist, so a 404 there would mean something is badly wrong. If it ever
happened, `null.text()` (or `.json()`) would throw, `safely` would catch
it, and Claude would see a confusing "Cannot read properties of null"
rather than a clean message.

### Errors as results (lines 33–41)

[http.ts:35-41](http.ts#L35-L41)

```js
const safely = (tool) => async (args) => {
  try {
    return await tool(args);
  } catch (e) {
    return failed(e.message ?? String(e));
  }
};
```

- **Two arrows in a row:** `safely` is a function that takes a function
  (`tool`) and returns a new function, `async (args) => ...`. The new one
  does what `tool` does, but inside a `try`. Wrapping a function like
  this is sometimes called a decorator. Each tool on lines 50–124 is
  passed through it: `safely(async (...) => { ... })`.
- **`return await`, not just `return`.** `tool(args)` returns a Promise.
  `return tool(args)` would hand that Promise back straight away and
  leave the `try`, so a failure afterwards would escape the `catch`.
  `await` waits for it *inside* the `try`, so the `catch` sees it. This is
  the one place where `return await` and `return` differ.
- Without `safely`, a thrown error would go back to Claude as a JSON-RPC
  protocol error. Claude Code shows those as a failed tool call, with
  less to go on. As a result with `isError`, Claude reads "Rooms returned
  HTTP 500: ..." and can tell you.
- **`e.message ?? String(e)`**: anything can be thrown in JavaScript, not
  just `Error` objects. Errors have a `.message`; for anything else,
  `String(e)` makes some text of it.

## The server (lines 43–127)

[http.ts:43-44](http.ts#L43-L44)

```js
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "backspaces", version: "1.0.0" });
  // ...register the tools...
  return server;
});
```

- `createMcpHandler` takes a **factory**: a function that builds a
  server. It's called afresh for each request, so no request sees
  anything left over from another. That's what lets the server be
  stateless, which suits val.town, where requests may land on different
  machines and nothing in memory is guaranteed to last.
- `name` and `version` are sent to the client in reply to `initialize`.
  (The `backspaces` in Claude Code's tool names, as in
  `mcp__backspaces__watch_status`, comes from the name given to
  `claude mcp add`, not from here; they just happen to match.)

### The shape of a tool

Each tool is one call with three arguments:

```js
server.registerTool("name", {
  annotations: readOnly,        // for the app: what kind of tool (above)
  description: "...",           // for the model: when to use it
  inputSchema: z.object({...}), // the arguments, checked before running
}, safely(async (args) => { ... return text("...") }));
```

- The **description** is the most important part for the model. It's how
  Claude decides that "is everything up?" means `watch_status`. They're
  written as plain statements of what the tool does and returns.
- **`z.object({...})`** describes an object with those keys. The SDK
  checks the arguments against it before calling the function, so the
  function can trust its input. A bad call never reaches it: the SDK
  replies with an `isError` result naming the problem, like this one for
  `read_room` with room `"bad name"`:

  ```
  Input validation error: Invalid arguments for tool read_room:
  room: Invalid string: must match pattern /^[\w-]{1,64}$/
  ```

- Tools with no arguments still pass `z.object({})`, an object with no
  keys.

### list_notes (lines 46–50)

[http.ts:50](http.ts#L50): `safely(async () => text(await (await call(notesUrl)).text()))`

- Read from the inside out: `await call(notesUrl)` gets the response,
  `.text()` starts reading its body (another Promise), the outer `await`
  waits for that, and `text(...)` wraps it as a result.
- **Two `await`s** because there are two waits: one for the response to
  start arriving, one for the whole body. `fetch` works this way so a
  program can look at the status and headers before deciding whether to
  read the body at all.
- Notes' `/` already returns a readable list of names, so it's passed on
  unchanged.

### read_note (lines 52–61)

[http.ts:58](http.ts#L58): `async ({ name }) => ...` destructures the
one argument out of the arguments object.

[http.ts:59](http.ts#L59): **`encodeURIComponent(name)`** makes the name
safe to put in a URL. A note called `to do` becomes `to%20do`; a `/` or
`?` in a name would otherwise change what the URL means.

[http.ts:60](http.ts#L60): the ternary chooses the result. `res` is
`null` after a 404 (from `call`), which is falsy, so a missing note
becomes `failed("No note called ...")`.

### read_room (lines 63–87)

[http.ts:69-73](http.ts#L69-L73): the arguments.

- `room: roomName` reuses the schema from line 13.
- **`.optional()`** means `since` may be left out, so Claude can call
  `read_room` with just a room name.

[http.ts:74](http.ts#L74): `async ({ room, since = 0 }) => ...`

- A **default inside destructuring**: if `since` wasn't given, it's `0`,
  meaning "from the start". The same idea as `join`'s options in
  PeersBreakdown.

[http.ts:75-76](http.ts#L75-L76): the same GET as Rooms' test page,
destructuring the same three fields.

[http.ts:78](http.ts#L78): who's been talking.

```js
const senders = [...new Set(messages.map((m) => m.from))];
```

- `messages.map((m) => m.from)` makes a list of each message's sender,
  with repeats.
- **`new Set(list)`** keeps one of each value, so the repeats go. A `Set`
  is like a `Map` with only keys.
- `[...set]` spreads it back into an array, which has `.join`.
- Rooms doesn't know who has a room open, only who has posted to it. The
  tool's description (lines 67–68) says so, so Claude won't claim more
  than it knows.

[http.ts:79-82](http.ts#L79-L82): one line of text per message.

- `${m.to ? " → " + m.to : ""}` adds the recipient only for a private
  message. A ternary inside a template literal's `${...}`.
- **`JSON.stringify(m.data)`**: a message's data can be any JSON, not
  just `{ text }` (Peers posts offers and answers through Rooms). Turning
  it back into JSON text shows Claude exactly what was sent, whatever
  shape it has.

[http.ts:83-86](http.ts#L83-L86): the reply. It gives the last id and, if
Rooms said `more`, tells Claude how to get the rest: call again with
`since`. Results are read by the model, so they can carry instructions
like that.

### post_to_room (lines 89–108)

[http.ts:97-98](http.ts#L97-L98): `.default("claude")`

- Unlike `.optional()`, **`.default(value)`** fills the value in when
  it's missing. So by the time the function runs, `from` is always set,
  and the code needs no fallback of its own.

[http.ts:100](http.ts#L100): `async ({ room, text: message, from }) => ...`

- **A rename while destructuring**: the argument called `text` arrives in
  a variable called `message`. Without it, a variable `text` would hide
  the `text` helper from line 21, and line 107's `text(...)` would try to
  call a string.

[http.ts:101-105](http.ts#L101-L105): the same POST as Rooms' test page, with
the message wrapped as `{ text: message }`, the form Rooms' page shows as
plain text. Here `call`'s second argument is used, and the spread on
line 27 adds the timeout to these options.

[http.ts:106-107](http.ts#L106-L107): Rooms replies with the new message's
`id`, which goes into the result so Claude can say "sent".

### watch_status (lines 110–124)

[http.ts:117-118](http.ts#L117-L118)

- Watch's `?json` returns `null` until its first check has run, so this
  case gets its own message rather than an error.

[http.ts:119-122](http.ts#L119-L122)

```js
Object.entries(status.targets).map(([name, t]) => ...)
```

- **`Object.entries(obj)`** turns an object into an array of
  `[key, value]` pairs: here `[["Rooms", {...}], ["Peers", {...}]]`.
- `([name, t]) =>` destructures each pair in the parameter list, the same
  as `for (const [id, peer] of peers)` in PeersBreakdown.
- The problem, if there is one, is added in parentheses. When everything
  is up, the lines stay short.

## The entry point (lines 129–166)

[http.ts:162-166](http.ts#L162-L166)

```js
export default (req) =>
  req.method === "GET" &&
    !req.headers.get("accept")?.includes("text/event-stream")
    ? new Response(note(new URL(req.url).origin + "/"))
    : handler.fetch(req);
```

- **`export default`** a function from `Request` to `Response` is what
  val.town calls for each HTTP request, as in every other val here.
- The whole body is one ternary: *condition* `?` browser note `:` MCP.
- **The condition** picks out a browser visit: a GET whose `accept` header
  doesn't ask for an event stream. `headers.get` returns `null` when the
  header is missing, so **`?.`** skips `.includes` and gives `undefined`,
  and `!undefined` is `true`. No `accept` header counts as a browser.
- Why not just "any GET"? The MCP spec lets a client open a GET with
  `accept: text/event-stream` to listen for messages the server starts
  on its own. This server never does that, and the SDK answers such a GET
  with 405, "method not allowed". Passing it through to the SDK keeps
  that answer correct for MCP clients; only people get the note.
- **The note** ([http.ts:129-160](http.ts#L129-L160)) is for people,
  not the model: what the address is for, the tools in plain words, and
  the claude.ai, Claude Code and Codex steps from [README.md](README.md). It's
  one **template literal** (backquotes), so it can span lines and drop
  the URL in with `${url}`. `note` is a function only so it can take
  that URL.
- `new URL(req.url).origin` is the scheme and host
  (`https://backspaces-mcp.val.run`), so the note shows the right URL
  even if the val is reached by another address.
- **`handler.fetch(req)`** hands everything else to the SDK.
  [README.md](README.md) ("Testing locally") explains why this is a plain
  function rather than `export default handler.fetch` alone.

## What's not here

- **No state.** Nothing is kept between requests, not even the server
  object. Everything lives in the other vals.
- **No auth.** Anyone with the URL can call these tools, which is why
  there's no tool for writing notes. [README.md](README.md) ("No auth, so
  read-mostly") has the reasoning.
- **No protocol code.** JSON-RPC, SSE, `initialize`, `tools/list` and the
  argument checking are all the SDK's. Adding a tool is one more
  `registerTool` call.
