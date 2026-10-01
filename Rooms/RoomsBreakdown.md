# Rooms, line by line

A walkthrough of [http.ts](http.ts), explaining the JavaScript as it
goes. [README.md](README.md) says what Rooms does; this file says how the
code does it.

`http.ts` has two parts:

- **The server** (lines 1–102) runs on val.town for every request.
- **The test page** (lines 104–195) is a string the server sends to
  browsers. Its script runs in the browser, not on val.town.

Browser-side ideas that get longer treatment in the
[Browser](https://github.com/backspaces/Browser) repo are linked rather
than re-explained.

## Imports and settings (lines 1–17)

[http.ts:1](http.ts#L1)

```js
import { sqlite } from 'https://esm.town/v/std/sqlite/main.ts'
```

Deno imports straight from a URL; there's no npm install step. `{ sqlite }` picks out the one named export we need. It's the per-val database, the same one Mailbox uses.

[http.ts:3-5](http.ts#L3-L5): plain constants. Two small idioms:

- `16 * 1024` is written as arithmetic so it reads as "16 KB".
- On line 72, `3600_000` uses `_` as a digit separator. It's just 3600000 (milliseconds in an hour), easier to read. `3_600_000` works too; the underscores can go between any two digits.

[http.ts:7-11](http.ts#L7-L11): the CORS headers.

- Browsers block a page on one site from reading responses from another site unless the server allows it. These three headers say:
    - any site may call us (`*`)
    - with GET, POST or OPTIONS
    - and may send a `content-type` header.
- This is why Peers, on a different subdomain, can use Rooms.
- Header names need quotes as object keys because they contain `-`.
- Only the first and third headers actually matter here: GET and POST are always allowed, so the methods line is mostly documentation. Browser's [CORS topic](https://github.com/backspaces/Browser/blob/main/CORS/README.md) explains each header and the OPTIONS "preflight".

[http.ts:13-17](http.ts#L13-L17): a helper for JSON replies.

```js
const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { ...cors, 'content-type': 'application/json' },
    })
```

- **Arrow function:** `(args) => expression` returns the expression, with no `return` or braces needed.
- **Default parameter:** `status = 200` applies when the caller leaves `status` out.
- **Shorthand property:** `{ status }` means `{ status: status }`.
- **Spread:** `...cors` copies all of `cors`'s keys into the new object, then `content-type` is added. So every JSON reply carries the CORS headers.
- **`Response`** is the standard web class for an HTTP reply (body, status, headers). Deno and val.town use the same one browsers use with `fetch`. See Browser's [fetch topic](https://github.com/backspaces/Browser/blob/main/fetch/README.md#request-and-response).

## Creating the table once (lines 19–36)

This is the densest part.

```js
let ready;
const setup = () =>
  ready ??= (async () => { ...create table, create index... })()
    .catch((e) => { ready = undefined; throw e; });
```

Reading from the inside out:

- **`(async () => { ... })()`** defines an async arrow function and calls it immediately (the trailing `()`). The result is a **Promise**, an object for "work in progress that will finish (or fail) later". The pattern gives us one Promise representing "the database is set up".
- **`await`** inside it pauses that function until each SQL call finishes, without blocking anything else.
- **`??=`** means "assign only if the left side is `null` or `undefined`". The first call to `setup()` finds `ready` undefined, so it starts the work and stores the Promise. Later calls find `ready` already set and return the same Promise without running the SQL again. So many requests share one setup, even if they arrive at the same moment.
- **`.catch(...)`** runs only if the setup fails. It clears `ready` so the next request tries again, then rethrows (`throw e`) so this request still reports the error. That's the fix from the first deploy: without it, one transient database error was cached forever.
- **Why `let ready` survives between requests:** val.town reuses the same running copy of this module (an "isolate") for a while, so module-level variables persist across requests, though not forever. The comment says "once per isolate" rather than "once ever" for that reason. `create table if not exists` makes it harmless when a fresh isolate runs it again.

The SQL (lines 22–31):

- `id integer primary key autoincrement` gives every message a number that always increases. That number is what makes `since` work.
- `recipient` is the only column allowed to be null, which marks a broadcast.
- The index on `(room, id)` makes "this room's messages after id N" fast.
- The backtick strings are template literals. Unlike `"..."`, they can span multiple lines.

## The handler (lines 38–51)

[http.ts:38](http.ts#L38): `export default async function (req)`

- val.town calls a file's default export once per HTTP request. `req` is a standard `Request`, and whatever `Response` we return is sent back. The handler is just a function from a Request to a Response.
- `async` lets us use `await` inside.
- HTTP methods (GET, POST, ...) aren't functions. `req.method` is a plain string, and the handler picks a branch with `if (req.method === 'POST')` and so on. Frameworks like Hono hide that behind `app.get(...)` and `app.post(...)`. Browser's [HTTP topic](https://github.com/backspaces/Browser/blob/main/HTTP/README.md#methods) covers what a request actually is.

[http.ts:39](http.ts#L39): `OPTIONS` requests. Before a cross-site POST with a JSON content type, the browser sends a "preflight" OPTIONS request asking whether it's allowed. We answer with only the CORS headers and no body (`null`).

[http.ts:41-46](http.ts#L41-L46)

- `new URL(req.url)` parses the full URL into parts: `.pathname` is `/room/bath`, and `.searchParams` holds the `?since=...` values.
- The path `/` returns the test page. `page` is defined at the bottom of the file. Code can use it even though it appears later, because the handler only runs after the whole module has loaded.

[http.ts:48-50](http.ts#L48-L50): route matching with a regular expression.

```js
url.pathname.match(/^\/room\/([\w-]{1,64})$/)
```

- `^` and `$` anchor the start and end, so the whole path must match.
- `\/room\/` is the literal `/room/`; the slashes are escaped because `/` delimits a regex.
- `( ... )` captures the room name, and `[\w-]{1,64}` means 1–64 letters, digits, `_` or `-`.
- `match` returns `null` on no match. Otherwise it returns an array whose element `[0]` is the whole match and `[1]` is the first captured group, which is why the room is `match[1]`.
- This also stops odd names like `bad name` (the 404 in the tests).

[http.ts:51](http.ts#L51): `await setup()` makes sure the table exists before touching it. It's instant after the first time.

## POST: adding a message (lines 53–78)

- **Line 54:** `await req.text()` reads the request body as a string. Reading the body takes time, hence the `await`.
- **Line 55:** size check before parsing. `413` is HTTP's "payload too large". Strictly, `.length` counts characters, not bytes, so the "16 KB" limit is approximate for non-ASCII text.
- **Lines 56–61:** `JSON.parse` throws on bad input, so it's wrapped in `try`/`catch`. `catch {` without `(e)` is valid when the error itself isn't needed. `msg` is declared with `let` outside the `try` so it's still visible after the block.
- **Line 62:** `!msg.from` rejects a missing or empty sender. The code uses `msg.data === undefined` rather than `!msg.data` on purpose, because `0`, `false` and `""` are valid data but would count as false.
- **Line 65:** `new Date().toISOString()` gives `"2026-09-25T17:03:12.345Z"`. These strings sort alphabetically in time order, which is why pruning can compare them with `<` (line 74).
- **Lines 66–71:** the insert.
    - The `?` placeholders are filled from `args` in order. The database does the substitution, so a message containing quotes or SQL can't break the query (no SQL injection).
    - `String(msg.from)` forces the value into text.
    - `msg.to ? String(msg.to) : null` is the ternary operator (`condition ? a : b`): a recipient if given, otherwise null, meaning broadcast.
    - `JSON.stringify(msg.data)` stores whatever JSON came in as text, because the column is plain text.
- **Lines 72–76:** delete anything older than 24 hours. `Date.now()` is milliseconds since 1970, so the arithmetic is simple, then it's turned back into an ISO string to compare with `created`.
- **Line 77:** reply with the new message's id and time.
    - `lastInsertRowid` comes from the SQLite library as a BigInt, a separate JavaScript type for very large integers.
    - `JSON.stringify` can't handle BigInt, so `Number(...)` converts it.
    - Peers uses this reply: the id of its own hello becomes its starting `since`.

## GET: reading messages (lines 80–99)

- **Line 81:**
    ```js
    Number(url.searchParams.get('since') ?? 0) || 0
    ```

    - `.get` returns the value as a string, or `null` if it's absent.
    - `??` means "use the right side if the left is `null` or `undefined`", so a missing `since` becomes 0.
    - `Number("abc")` gives `NaN` (not a number), and `NaN || 0` gives 0. `||` falls back on any false-like value, and NaN counts as one.
    - Net effect: missing or garbage input means "from the start".
- **Line 82:** `me` can legitimately be `null`. In SQL, `recipient = null` is never true, so an anonymous reader gets broadcasts only.
- **Lines 83–89:** the query. It returns this room's messages after `since` that are either broadcasts, addressed to me, or sent by me, oldest first, at most 100.
    - `me` appears twice in `args` because there are two `?` for it.
    - `const { rows } = ...` is **destructuring**: `execute` returns an object with several fields (`columns`, `rows`, ...), and this pulls out just `rows` into a variable of the same name.
- **Lines 90–96:** `.map` builds a new array by transforming each row. Two details:
    - The arrow function returns an object literal, so it's wrapped in parentheses: `(r) => ({ ... })`. Without them, `{` would be read as the start of a function body.
    - This step also renames the database columns back to the API's names (`sender` becomes `from`), and `JSON.parse(r.body)` turns the stored text back into real JSON.
- **Line 97:** `last` is the id of the final message, which the client sends back as its next `since`. With no messages, it's `since` unchanged. `.at(-1)` means "last element"; negative indexes count from the end.
- **Line 98:** `more` is true when we hit the 100 limit, telling the client to ask again right away rather than wait a second.

**Line 101:** any other method (PUT, DELETE, ...) gets `405`, "method not allowed".

## The test page (lines 104–195)

[http.ts:105](http.ts#L105): `const page = \`<!doctype html> ...\``

- The whole page is one template literal, sent as-is by the `/` branch on line 43. The server never runs any of it. The browser receives it as text, builds the page, and runs the `<script>`.
- So this file holds code for two different places: lines 1–102 run in Deno on val.town, and lines 127–192 run in a browser.
- Being inside a template literal is why the page's script never uses backticks or `${...}`. Either would end the string or be filled in on the server, so the script builds strings with `+` instead.

**Lines 106–125: HTML and CSS.**

- `<meta name="viewport" ...>` tells phones to use the real screen width instead of pretending to be a desktop and shrinking everything.
- In the CSS, `#log` targets the element with `id="log"`, and `.me` targets elements with `class="me"`.
- `white-space: pre-wrap` on each log line keeps line breaks and indentation, so multi-line text and pretty-printed JSON display properly.
- `display: flex` on the form lays out the textarea and button in a row; `flex: 1` lets the textarea take the leftover width.
- The elements the script uses all have ids: `room`, `me`, `log`, `form`, `text`.
- `<button>Send</button>` inside a `<form>` is a submit button by default, so clicking it submits the form. The script never listens for the click; it handles the form's submit instead (line 181).

### Setting up (lines 126–134)

[http.ts:126](http.ts#L126): `<script type="module">`

- A module script runs after the whole page has been read, so every element above already exists when it looks them up.
- Its top-level `const`s stay private to the script instead of becoming global variables.
- Modules can also `import` other files. This one doesn't, but Peers' page does.

[http.ts:127](http.ts#L127)

```js
const room = new URLSearchParams(location.search).get('room') || 'rooms'
```

- `location` is the page's own URL. `location.search` is the `?room=bath` part.
- `URLSearchParams` parses it, the same class the server uses through `url.searchParams`.
- `||` rather than `??` on purpose: `?room=` with nothing after it gives `""`, and `||` treats an empty string as missing too.

[http.ts:128](http.ts#L128)

```js
const me = sessionStorage.me ||= 'peer-' + Math.random().toString(36).slice(2, 7)
```

- **`sessionStorage`** is storage the browser keeps per tab. It survives a reload but not closing the tab, and a new tab starts empty. That's why each tab gets its own peer id. It stores only strings. `sessionStorage.me` is shorthand for `sessionStorage.getItem('me')`, and assigning to it calls `setItem`.
- **`||=`** means "assign only if the left side is false-like". The first visit finds nothing stored and makes an id; a reload finds the stored one and keeps it.
- **The id:** `Math.random()` gives something like `0.4fzyo...` once `.toString(36)` writes it in base 36 (digits 0–9 then a–z). `.slice(2, 7)` skips the `0.` and keeps five characters. That's about 60 million possibilities: not guaranteed unique, but a clash in one room is very unlikely.

[http.ts:129-130](http.ts#L129-L130)

- `location.origin` is `https://backspaces-rooms.val.run`, so the page talks to the server it came from. That's a same-origin request, so CORS never comes into it here.
- `since` is the cursor from the GET section: the id of the last message seen, starting at 0.

[http.ts:132-134](http.ts#L132-L134): fill in the room name and peer id with `textContent`, and keep a reference to the log element, which is used on every message.

### Showing a message (lines 136–151)

[http.ts:137-140](http.ts#L137-L140): `describe(data)` decides how to display a message's data.

- Plain text arrives as `{ text: '...' }` (see `toData` below), so an object whose only key is a string `text` is shown as that text.
- `data &&` comes first because data can be `null`, and `null.text` would throw an error.
- `Object.keys(data)` lists an object's own keys, so `.length === 1` means "nothing but `text`".
- Anything else is shown with `JSON.stringify(data, null, 2)`. The third argument is the indent: 2 spaces per level, one key per line. That's the pretty-printing.

[http.ts:142-151](http.ts#L142-L151): `show(m)` adds one line to the log.

- It builds the line with `createElement` and `textContent`, never `innerHTML`, so a stranger's message can't inject HTML or code. Browser's [DOM topic](https://github.com/backspaces/Browser/blob/main/DOM/README.md#textcontent-vs-innerhtml) shows exactly what goes wrong otherwise.
- `m.from === me ? 'me' : ''` gives your own lines the `me` class, which the CSS colors blue.
- `new Date(m.time).toLocaleTimeString()` turns the server's UTC timestamp into a time in your own time zone and format.
- `log.scrollTop = log.scrollHeight` scrolls the log to the bottom. `scrollHeight` is the full height of the content; setting `scrollTop` to it goes as far down as possible.

### The polling loop (lines 153–164)

[http.ts:153-164](http.ts#L153-L164)

```js
async function poll() {
    try {
        const res = await fetch(base + '?since=' + since + '&me=' + me)
        const { messages, last, more } = await res.json()
        messages.forEach(show)
        since = last
        if (more) return poll()
    } catch (e) {
        console.warn('poll failed', e)
    }
    setTimeout(poll, 1000)
}
```

- `fetch(url)` with no options is a GET. It waits for the response headers, and `await res.json()` then waits for the body and parses it.
- `const { messages, last, more } = ...` uses destructuring to pull out the three fields the server's GET returns.
- `messages.forEach(show)` passes the function itself, not a call to it. `forEach` calls `show` once per message.
- `since = last` moves the cursor forward, so the next poll asks only for newer messages.
- `if (more) return poll()` fetches the next page at once. The `return` matters: without it, the code would also reach `setTimeout` and start a second, parallel loop.
- The `try`/`catch` keeps the loop alive through failures. A network error, or a reply that isn't the expected JSON, is logged to the console, and the next poll tries again. One consequence: a room name the server rejects (`?room=bad name`) fails quietly, visible only in the console.
- **`setTimeout(poll, 1000)`** schedules one more poll a second from now. Each poll schedules the next, which makes a loop. This is safer than `setInterval(poll, 1000)`, which fires every second whether or not the previous request has finished. On a slow connection that could overlap requests and show messages twice.
- Nothing waits for the Promise that the `async` function `poll` returns. It's started and left to run.

### Sending (lines 166–190)

[http.ts:166-170](http.ts#L166-L170): Ctrl+Enter to send.

- `input.onkeydown` runs on every key press in the textarea, and `e` is the event, describing the key.
- `e.key === 'Enter'` checks which key. `e.metaKey` is ⌘ on a Mac, and `e.ctrlKey` is Ctrl. A plain Enter still types a newline.
- `form.requestSubmit()` submits the form as if the button were clicked, which fires the submit handler below. The older `form.submit()` skips the handler and reloads the page, so it would be wrong here.

[http.ts:173-179](http.ts#L173-L179): `toData(value)`. If the text parses as JSON, send the parsed value; otherwise send `{ text: value }`. The same `try`/`catch` pattern the server uses on lines 57–61.

[http.ts:181-190](http.ts#L181-L190): the submit handler.

- **`e.preventDefault()`** stops the browser's default for a submitted form, which is to navigate to a new page and reload. Without it, the page would reload on every message.
- `.trim()` removes surrounding spaces and newlines, so a whitespace-only message is ignored.
- `fetch(base, { method: 'POST', headers, body })` sends the message. `body` must be a string, hence `JSON.stringify`.
- The page doesn't add your message to the log itself. It appears when the next poll brings it back from the server. That's why the server's GET includes `sender = ?`: your own messages are in your feed, including ones you sent privately.
- `input.value = ''` runs after the `await`, so the box clears only once the server has accepted the message.

[http.ts:192](http.ts#L192): `poll()` starts the loop, and the page is running.
