# Mcp, line by line

A walkthrough of Mcp's two files, explaining the JavaScript as it goes.
[README.md](README.md) says what Mcp does and how to connect to it; this
file says how the code does it. It builds on
[RoomsBreakdown.md](../Rooms/RoomsBreakdown.md) and
[PeersBreakdown.md](../Peers/PeersBreakdown.md): ideas explained there
(arrow functions, destructuring, spread, `??`, the ternary) are only
pointed to here.

- **[http.ts](http.ts)** (93 lines) is the tools: one plain object per
  tool, saying what it's called, what it does, what arguments it takes,
  and the code that runs. This is the file to copy for a new server.
- **[mcp.ts](mcp.ts)** (132 lines) is the helper, `mcpServer`, that turns
  those objects into an MCP server, plus a page for browser visits. It
  knows nothing about notes or rooms.

Most of the work, though, is done by the MCP SDK, so it helps to see
first what actually goes over the wire.

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
data: {"result":{"content":[{"type":"text","text":"Last checked 2026-10-14T22:00:03.837Z\nRooms: up since 2026-10-01T23:30:04.714Z\nPeers: up since 2026-10-02T21:54:35.604Z\nRest: up since 2026-10-07T20:54:38.088Z"}]},"jsonrpc":"2.0","id":1}
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

The path through the code: val.town calls http.ts's default export,
which is the function `mcpServer` returned
([mcp.ts:124-131](mcp.ts#L124-L131)). It hands the request to the SDK,
which parses the JSON-RPC, finds the tool, checks the arguments against
its schema, and calls that tool's `run` from http.ts. `run` returns a
string; mcp.ts wraps it as an MCP result and the SDK writes it as SSE.

# Part 1: http.ts, the tools

## Import (line 4)

[http.ts:4](http.ts#L4): `import { call, mcpServer, z } from "./mcp.ts"`

- **`./mcp.ts`** is a file in the same val. Val Town wants the `.ts` on
  the end. (VS Code's TypeScript checker complains about that; Deno, which
  val.town runs on, doesn't. Watch imports `./watch.ts` the same way.)
- Three names come in: `mcpServer` builds the server, `call` fetches
  another val's URL, and `z` describes arguments. All three are explained
  in Part 2.

## Settings (lines 6–10)

[http.ts:6-8](http.ts#L6-L8): the three vals' public URLs.

- These are the same URLs a browser would use. Mcp has no special access
  to the other vals: it's just another client of theirs.

[http.ts:9-10](http.ts#L9-L10): a zod schema for a room name, used by
two tools.

```js
const roomName = z.string().regex(/^[\w-]{1,64}$/)
  .describe('Room name: letters, digits, "_" or "-", e.g. "rooms"');
```

- [zod](https://zod.dev/) describes the shape data should have, and
  checks data against it.
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

## The shape of a tool

[http.ts:12](http.ts#L12): `export default mcpServer({ ... })`

- **`export default`** is what val.town calls for each HTTP request, as
  in every other val here. `mcpServer` returns that function.
- Its one argument is an object with **one key per tool**: the key is
  the tool's name, the value describes it.

Each tool has up to five fields:

```js
read_note: {
  description: "...",            // for the model: when to use it
  readOnly: true,                // for the app: what kind of tool
  args: { name: z.string()... }, // the arguments, checked before running
  run: async ({ name }) => { ... return "some text"; },
},
```

- The **description** is the most important part for the model. It's how
  Claude decides that "is everything up?" means `watch_status`. They're
  written as plain statements of what the tool does and returns.
- **`readOnly`** and **`destructive`** are hints for the app (claude.ai,
  Claude Code), not the model. Part 2 ("Tool hints") has the details.
  Four tools here say `readOnly: true`; `post_to_room` says it changes
  things, but only by adding.
- **`args`** has one zod schema per argument. Leave it out for a tool with
  no arguments. The SDK checks each call's arguments against it before
  `run` is called, so `run` can trust its input. A bad call never reaches
  it: the SDK replies with an error result naming the problem, like this
  one for `read_room` with room `"bad name"`:

  ```
  Input validation error: Invalid arguments for tool read_room:
  room: Invalid string: must match pattern /^[\w-]{1,64}$/
  ```

- **`run`** gets the arguments as one object and returns a string, the
  text Claude will read. To report a problem, it **throws**: the message
  becomes an error result Claude can read and explain.

## list_notes (lines 13–17)

[http.ts:16](http.ts#L16): `run: async () => (await call(notesUrl)).text()`

- `await call(notesUrl)` waits for the response; `.text()` reads its body.
- **No second `await`?** `.text()` returns a Promise, and an `async`
  function that returns a Promise passes it along: whoever awaits `run`
  gets the text. (Two waits happen: one for the response to start
  arriving, one for the whole body. `fetch` works this way so a program
  can look at the status and headers before deciding whether to read the
  body at all.)
- Notes' `/` already returns a readable list of names, so it's passed on
  unchanged.

## read_note (lines 19–28)

[http.ts:23](http.ts#L23): `run: async ({ name }) => ...` destructures the
one argument out of the arguments object.

[http.ts:24](http.ts#L24): **`encodeURIComponent(name)`** makes the name
safe to put in a URL. A note called `to do` becomes `to%20do`; a `/` or
`?` in a name would otherwise change what the URL means.

[http.ts:25](http.ts#L25): `if (!res) throw new Error(...)`. `res` is
`null` after a 404 (see `call`, Part 2), which is falsy, so a missing
note becomes an error result: `No note called "shopping".`

## read_room (lines 30–53)

[http.ts:36-40](http.ts#L36-L40): the arguments.

- `room: roomName` reuses the schema from line 9.
- **`.optional()`** means `since` may be left out, so Claude can call
  `read_room` with just a room name.

[http.ts:41](http.ts#L41): `run: async ({ room, since = 0 }) => ...`

- A **default inside destructuring**: if `since` wasn't given, it's `0`,
  meaning "from the start". The same idea as `join`'s options in
  PeersBreakdown.

[http.ts:42-43](http.ts#L42-L43): the same GET as Rooms' test page,
destructuring the same three fields.

[http.ts:45](http.ts#L45): who's been talking.

```js
const senders = [...new Set(messages.map((m) => m.from))];
```

- `messages.map((m) => m.from)` makes a list of each message's sender,
  with repeats.
- **`new Set(list)`** keeps one of each value, so the repeats go. A `Set`
  is like a `Map` with only keys.
- `[...set]` spreads it back into an array, which has `.join`.
- Rooms doesn't know who has a room open, only who has posted to it. The
  tool's description (lines 32–34) says so, so Claude won't claim more
  than it knows.

[http.ts:46-49](http.ts#L46-L49): one line of text per message.

- `${m.to ? " → " + m.to : ""}` adds the recipient only for a private
  message. A ternary inside a template literal's `${...}`.
- **`JSON.stringify(m.data)`**: a message's data can be any JSON, not
  just `{ text }` (Peers posts offers and answers through Rooms). Turning
  it back into JSON text shows Claude exactly what was sent, whatever
  shape it has.

[http.ts:50-51](http.ts#L50-L51): the reply. It gives the last id and, if
Rooms said `more`, tells Claude how to get the rest: call again with
`since`. Results are read by the model, so they can carry instructions
like that.

## post_to_room (lines 55–76)

[http.ts:59-60](http.ts#L59-L60): `readOnly: false, destructive: false`:
it changes something, but only by adding a message, never deleting or
overwriting one.

[http.ts:64-65](http.ts#L64-L65): `.default("claude")`

- Unlike `.optional()`, **`.default(value)`** fills the value in when
  it's missing. So by the time `run` is called, `from` is always set, and
  the code needs no fallback of its own.

[http.ts:68-72](http.ts#L68-L72): the same POST as Rooms' test page, with
the message wrapped as `{ text }`, the form Rooms' page shows as plain
text. `{ text }` is **shorthand** for `{ text: text }`. Here `call`'s
second argument (method, headers, body) is used.

[http.ts:73-74](http.ts#L73-L74): Rooms replies with the new message's
`id`, which goes into the result so Claude can say "sent".

## watch_status (lines 78–92)

[http.ts:84-85](http.ts#L84-L85)

- Watch's `?json` returns `null` until its first check has run, so this
  case gets its own message rather than an error.

[http.ts:86-89](http.ts#L86-L89)

```js
Object.entries(status.targets).map(([name, t]) => ...)
```

- **`Object.entries(obj)`** turns an object into an array of
  `[key, value]` pairs: here
  `[["Rooms", {...}], ["Peers", {...}], ["Rest", {...}]]`.
- `([name, t]) =>` destructures each pair in the parameter list, the same
  as `for (const [id, peer] of peers)` in PeersBreakdown.
- The problem, if there is one, is added in parentheses. When everything
  is up, the lines stay short.

# Part 2: mcp.ts, the helper

## Imports (lines 4–10)

[mcp.ts:4-7](mcp.ts#L4-L7)

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

[mcp.ts:8](mcp.ts#L8): `import * as z from "npm:zod@4/v4"`

- **`import * as z`** is a namespace import: everything the module
  exports, gathered into one object called `z`. So `z.string()`,
  `z.object()` and so on.
- `/v4` is a path inside the package, choosing zod's version 4
  interface, which is the one this SDK expects.

[mcp.ts:10](mcp.ts#L10): `export { z }` **re-exports** it, so http.ts
gets zod from here. The tools' schemas and the SDK are then sure to use
the same copy and version.

## Calling another val (lines 12–21)

[mcp.ts:16](mcp.ts#L16): `export async function call(url, init = {})`

- `init` is `fetch`'s second argument (method, headers, body). **`= {}`
  is a default parameter**: GET-only callers leave it out, and it's an
  empty object rather than `undefined`, so the spread on the next line
  works.

[mcp.ts:17](mcp.ts#L17)

```js
const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
```

- Copies the caller's options and adds one: a `signal`.
- **`AbortSignal.timeout(ms)`** makes a signal that fires after that
  long. `fetch` watches its signal, and when it fires, abandons the
  request and throws. Without it, a val that hangs would hang this tool,
  and Claude, with it. Ten seconds (line 12; `10_000` is `10000`, the
  underscore is only for reading) is generous for vals that normally
  answer in well under one.

[mcp.ts:18-20](mcp.ts#L18-L20): three outcomes.

- **404 returns `null`.** "No such note" is a normal answer, not a
  failure, so it's left to each tool to say so in its own words
  (`read_note` does).
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

`call` isn't needed for an MCP server; it's here because tools that
forward to other vals all want it. A tool can use plain `fetch`, or not
fetch anything.

## Tool hints (lines 23–28)

[mcp.ts:25-28](mcp.ts#L25-L28)

```js
const hints = ({ readOnly, destructive }) => ({
  ...(readOnly !== undefined && { readOnlyHint: readOnly }),
  ...(destructive !== undefined && { destructiveHint: destructive }),
});
```

MCP calls these **annotations**: optional hints, sent with each tool in
`tools/list`, that say what kind of thing a tool does. They're aimed at
the app (claude.ai, Claude Code), not the model: the app can use them to
group tools or decide which need your OK.

- `readOnlyHint: true`: the tool only reads.
- `destructiveHint: false`: the tool changes something, but only by
  adding. Without it, MCP's default is to assume a tool that isn't
  read-only might be destructive.
- They're *hints*: the SDK sends them as written and checks nothing. The
  spec tells clients not to trust them from servers they don't trust,
  since nothing stops a server from labelling a deleting tool "read-only".

The code:

- `hints` destructures a tool object, taking only the two fields it
  cares about.
- **Conditional spread:** `...(cond && { key: value })`. When `cond` is
  true, `&&` gives the object, and its key is spread in. When it's false,
  `&&` gives `false`, and spreading `false` adds nothing. So a field the
  tool left out isn't sent at all, rather than sent as `undefined`.
- `!== undefined`, not just `readOnly &&`, so that `readOnly: false` is
  still sent.

## Tool results and errors (lines 30–40)

[mcp.ts:30](mcp.ts#L30): `const text = (s) => ({ content: [{ type: "text", text: s }] })`

- MCP's tool result is an object with a `content` array, because a
  tool can return several pieces, including images. Every tool here
  returns one piece of text, so `text` builds that shape from a string.
- The parentheses around `{ ... }` make the arrow function return an
  object, rather than starting a function body (see RoomsBreakdown,
  "GET").

[mcp.ts:34-40](mcp.ts#L34-L40)

```js
const safely = (run) => async (args) => {
  try {
    return text(String(await run(args)));
  } catch (e) {
    return { ...text(e.message ?? String(e)), isError: true };
  }
};
```

- **Two arrows in a row:** `safely` is a function that takes a function
  (a tool's `run`) and returns a new function, `async (args) => ...`.
  The new one calls `run`, but inside a `try`, and turns its string into
  an MCP result. Wrapping a function like this is sometimes called a
  decorator.
- **`await` inside the `try`.** `run(args)` returns a Promise; `await`
  waits for it *inside* the `try`, so a failure while it runs is caught
  by the `catch`.
- `String(...)` makes sure the result is text, even if a `run` returns a
  number by mistake.
- On an error, the same shape plus **`isError: true`**, built by
  spreading `text(...)` into a new object and adding one key. `isError`
  tells Claude the tool ran but didn't succeed. It's still an ordinary
  result, so Claude reads the text ("Rooms returned HTTP 500: ...") and
  can explain it, or try again differently. Without `safely`, a thrown
  error would go back as a JSON-RPC protocol error, which Claude Code
  shows as a failed tool call, with less to go on.
- **`e.message ?? String(e)`**: anything can be thrown in JavaScript, not
  just `Error` objects. Errors have a `.message`; for anything else,
  `String(e)` makes some text of it.

## Building the server (lines 63–78)

[mcp.ts:66-78](mcp.ts#L66-L78)

```js
export function mcpServer(tools) {
  const handlerFor = (name) =>
    createMcpHandler(() => {
      const server = new McpServer({ name, version: "1.0.0" });
      for (const [toolName, tool] of Object.entries(tools)) {
        server.registerTool(toolName, {
          annotations: hints(tool),
          description: tool.description,
          inputSchema: z.object(tool.args ?? {}),
        }, safely(tool.run));
      }
      return server;
    });
```

- `createMcpHandler` takes a **factory**: a function that builds a
  server. It's called afresh for each request, so no request sees
  anything left over from another. That's what lets the server be
  stateless, which suits val.town, where requests may land on different
  machines and nothing in memory is guaranteed to last.
- **The loop** registers each tool from http.ts. `Object.entries(tools)`
  gives `[name, tool]` pairs, as in `watch_status`.
- **`registerTool(name, config, function)`** is the SDK's way to add a
  tool. Each of our tool fields maps onto it: the hints become
  `annotations`, `description` is passed as is, `args` becomes
  `inputSchema`, and `run` becomes the function, wrapped by `safely`.
- **`z.object(tool.args ?? {})`** wraps the arguments as one object
  schema, which is what the SDK wants. `?? {}` gives tools with no `args`
  an object with no keys.
- `handlerFor` takes the server's `name` because the name comes from the
  request, next.

## The server's name (lines 58–61)

[mcp.ts:61](mcp.ts#L61)

```js
const nameOf = (req) => new URL(req.url).hostname.split(".")[0].replace(/-mcp$/, "");
```

- `hostname` is `backspaces-mcp.val.run`; `.split(".")[0]` is the first
  part, `backspaces-mcp`; and **`.replace(/-mcp$/, "")`** drops a
  trailing `-mcp` (`$` is the end of the string), leaving `backspaces`.
- So http.ts never says its own name. A val whose address is
  `owen-weather.val.run` would be called `owen-weather`.
- The name is sent to the client in reply to `initialize`, and the
  browser page suggests adding the server under it. (The `backspaces` in
  Claude Code's tool names, as in `mcp__backspaces__watch_status`, comes
  from the name given to `claude mcp add`, not from here; the page just
  suggests the same one.)

## The page for browsers (lines 42–56, 80–122)

The page lists the tools as clients see them, the way Val Town's
[mcp-docs](https://mcp-docs.val.run/) does for theirs. Rather than a
hand-written list that can fall behind the code, it asks the server.

[mcp.ts:82-93](mcp.ts#L82-L93): `toolList(handler)`

- It builds the same `tools/list` request a client sends (see "One call,
  start to finish") as a **`new Request(...)`**, and passes it straight
  to `handler.fetch`. No network: it's a function call that happens to
  take and return HTTP objects. The `http://localhost/` URL is never
  visited; a `Request` just needs one.
- The reply is SSE, so `.match(/^data: (.*)$/m)` pulls out the `data:`
  line. In a regular expression, `^` and `$` mean the start and end of a
  line because of the **`m`** (multiline) flag; `(.*)` captures the rest,
  and `[1]` is that capture. `JSON.parse` turns it into the JSON-RPC
  reply, and `.result.tools` is the array.

[mcp.ts:44-56](mcp.ts#L44-L56): `describe(tool)`, one tool as text.

- Destructures one tool from that array: `inputSchema` is the JSON
  Schema the SDK made from the zod schema, with `properties` (one per
  argument) and `required` (their names). `= {}` and `= []` cover tools
  with no arguments, where the SDK leaves `required` out.
- Each argument becomes one line: name, type, then "required" and the
  default only when they apply. Each `(cond ? "..." : "")` adds text or
  nothing, so the line stays short.
- The hints become "read-only", "adds, never deletes" or "can change
  things": a ternary with a second ternary as its "else".

[mcp.ts:98-122](mcp.ts#L98-L122): `note(name, url, list)`

- **The note** is for people, not the model: what the address is for,
  the tools, and the claude.ai, Claude Code and Codex steps from
  [README.md](README.md). It's one **template literal** (backquotes), so
  it can span lines and drop values in with `${...}`: the name, the URL,
  and `list.map(describe).join("\n\n")`, the tools with a blank line
  between them.

## The entry point (lines 124–131)

[mcp.ts:124-131](mcp.ts#L124-L131)

```js
return async (req) => {
  const name = nameOf(req);
  const handler = handlerFor(name);
  return req.method === "GET" &&
      !req.headers.get("accept")?.includes("text/event-stream")
    ? new Response(note(name, new URL(req.url).origin + "/", await toolList(handler)))
    : handler.fetch(req);
};
```

- This is the function `mcpServer` returns, so it's what http.ts exports
  and val.town calls for each request. It's `async` because building the
  note awaits `toolList`.
- It works out the name, builds a handler with it, then one ternary:
  *condition* `?` browser note `:` MCP.
- **The condition** picks out a browser visit: a GET whose `accept` header
  doesn't ask for an event stream. `headers.get` returns `null` when the
  header is missing, so **`?.`** skips `.includes` and gives `undefined`,
  and `!undefined` is `true`. No `accept` header counts as a browser.
- Why not just "any GET"? The MCP spec lets a client open a GET with
  `accept: text/event-stream` to listen for messages the server starts
  on its own. This server never does that, and the SDK answers such a GET
  with 405, "method not allowed". Passing it through to the SDK keeps
  that answer correct for MCP clients; only people get the note.
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
  argument checking are all the SDK's. Adding a tool is one more entry in
  http.ts.
