# Mcp

Eighth val: an [MCP](https://modelcontextprotocol.io/) server, so Claude
(in Claude Code or claude.ai), or any other MCP client, can use the other
vals as tools. You ask "what's on my shopping note", "what's been said in
room rooms" or "is everything up?" and Claude calls the matching tool.

**MCP is not an AI.** It adds abilities to an AI you already use: the AI
does the thinking, and this val gives it hands. The AI app (Claude Code,
claude.ai…) is the MCP *client*; this val is the *server*; Notes, Rooms
and Watch sit behind it, unchanged.

- `http.ts`: the whole server. It's Val Town's
  [mcp-server template](https://www.val.town/x/templates/mcp-server)
  (from their guide
  [How to build an MCP server](https://docs.val.town/guides/how-to-build-an-mcp-server/))
  with the example tool swapped for these (below).
- `McpBreakdown.md`: a line-by-line walkthrough of `http.ts`, explaining
  the JavaScript and what goes over the wire.

| Tool | Calls |
| --- | --- |
| `list_notes` | `GET` Notes `/` |
| `read_note(name)` | `GET` Notes `/<name>` |
| `read_room(room, since?)` | `GET` Rooms `/room/<room>`, plus the list of senders |
| `post_to_room(room, text, from="claude")` | `POST` Rooms `/room/<room>` |
| `watch_status` | `GET` Watch `/?json` (added to Watch for this) |

Each tool calls the val's public URL, just as a browser would, the same
way Watch checks Rooms and Peers. No val reads another val's storage.

## How it works

The SDK (`npm:@modelcontextprotocol/server@2`) does the protocol work.
`createMcpHandler` builds a fresh `McpServer` for each request, and
`registerTool` takes a name, a description, a
[zod](https://zod.dev/) schema for the arguments, and a function that
returns `{ content: [{ type: "text", text }] }`. The model reads the
descriptions to decide which tool to use, so they're written for the model.
The zod schemas are checked before the function runs, so a bad room name
comes back as an error the model can read.

Each tool also carries **annotations**, hints for the app rather than the
model: the four read tools say `readOnlyHint: true`, and `post_to_room`
says it changes something but isn't destructive (it only adds a message).
See [McpBreakdown.md](McpBreakdown.md), "Tool hints".

Errors from the other vals (a timeout, an HTTP 500) are also returned as
tool results with `isError: true`, instead of failing the whole request,
so Claude can say what went wrong.

The transport is **streamable HTTP**: every call is a `POST` of a
JSON-RPC message, and the reply comes back as server-sent events. One
request, one reply, and nothing kept between calls, which suits Val Town.

## No auth, so read-mostly

Anyone who has the URL can use this server, just as anyone can use the
vals behind it. That's why there is no tool for writing notes: Notes
needs its password for that, and if this val held the password, anyone
with this URL could write notes. `post_to_room` is fine, because Rooms
already lets anyone post. Adding note writing would mean protecting the
server first (Val Town's guide links to OAuth examples).

## Trying it

Endpoint (subdomain claimed):
`https://backspaces-mcp.val.run/`. Opening it in a browser shows a short
note on how to connect; MCP clients get the real server.

From the shell, one tool call (the `accept` header is required):

```sh
curl -s $URL -H content-type:application/json \
  -H accept:application/json,text/event-stream \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"watch_status","arguments":{}}}'
```

## Using it from Claude Code or Codex

For programmers who already use either (e.g. in VS Code). The easiest
way works the same in both: paste this sentence into a chat, and let the
AI run its own app's command (it asks permission first):

> Add the MCP server at https://backspaces-mcp.val.run/ under the name
> backspaces, available in all my projects.

Then start a **new** chat (tools load when a chat starts) and ask "What
notes do I have?". Tested with this exact sentence in Codex's VS Code
extension; in Claude Code's, this repo's own setup was done the same way
(Claude ran the command when asked).

Or run the commands yourself, if `claude` and `codex` are on your PATH
(the VS Code extensions don't put them there; `brew install --cask
claude-code` and `brew install codex` do):

```sh
claude mcp add --transport http --scope user backspaces https://backspaces-mcp.val.run/
codex mcp add backspaces --url https://backspaces-mcp.val.run/
```

`--scope user` makes Claude Code's entry work in every folder, which is
what Codex does anyway. Without it, Claude Code ties the server to the
folder you ran the command in (as this repo's own setup is).

Where each app keeps the entry, and how to undo it:

| App | Entry | Remove with |
| --- | --- | --- |
| Claude Code | `~/.claude.json` (`mcpServers` under `projects["<folder>"]`, or at the top level for `--scope user`) | `claude mcp remove backspaces` |
| Codex | `~/.codex/config.toml`: `[mcp_servers.backspaces]` and its `url` line | `codex mcp remove backspaces` |

In Claude Code, `/mcp` shows whether `backspaces` is connected.

## Using it from claude.ai

The way to offer it to other people: anyone with a Claude account (the
Free plan allows one custom connector) can add it in the browser.

1. **Customize → Connectors**
   ([claude.ai/customize/connectors](https://claude.ai/customize/connectors)),
   then **+ Add → Custom**.
2. **Name:** `backspaces`. **MCP server URL:**
   `https://backspaces-mcp.val.run/`. **Continue**.
3. **Authentication:** leave **No sign-in**. claude.ai checks the server
   and marks it **Detected**. Its warning that anyone with the URL can use
   the connector is expected (see [No auth](#no-auth-so-read-mostly)).
   Leave Request headers and Advanced alone. **Add**.
4. On the connector's page, **Connect**. Adding saves it; connecting turns
   it on for your account. To find the page again later, open
   **Customize → Connectors** and click the **Yours** tab (next to
   **Discover**, which opens by default and only shows Anthropic's
   directory), then **backspaces**.
5. Optional: set each tool's permission: ✓ always allow, ✋ needs approval
   (the default), ⃠ blocked. Permissions are **per tool**: "Always allow"
   on List notes doesn't cover Read note. A good setting: ✓ for the four
   read tools, ✋ for Post to room, the only one that changes anything.
6. In a new chat, ask in plain words: "What notes do I have?" Claude
   asks to use **List notes** (Allow once / Always allow), then answers.

If Claude doesn't use the tools, check **+ → Connectors** in the chat box:
`backspaces` must be on for that chat.

claude.ai calls the server from Anthropic's computers, not from yours, so
it only works because the server is on the public internet.

## The bigger picture: building is easy, connecting isn't

The protocol is standard: once an app connects, the same five tools work
anywhere. What isn't standard is whether, and how, each app lets you
connect your own server. That's each company's product and safety
decision, and it changes often (claude.ai's menus moved even while this
was being written).

| App | Can a regular person add this server? |
| --- | --- |
| Claude Code | Yes: a command, or ask it in a chat (tested) |
| claude.ai | Yes, on every plan; Free allows one custom connector (tested) |
| Gemini | Reportedly, for US adults with a personal Google account: gemini.google.com → Settings → Connected Apps → Add a custom app (untested) |
| ChatGPT | Reportedly only on Business/Enterprise plans, with Developer Mode switched on by an admin. A paid personal plan wasn't enough (tried 2026-10-06). ChatGPT separates **published** apps (reviewed and listed in its directory, like [Val Town's own plugin](https://docs.val.town/guides/prompting/chatgpt), which installs on personal plans) from **custom** servers like this one (any URL, which needs Developer Mode). Listing this one would mean submitting it to OpenAI for review |
| Claude desktop app | Should share claude.ai's connectors (untested) |
| Codex | Yes: a command, or ask it in a chat (tested 2026-10-06, VS Code extension) |

Others that reportedly accept MCP servers by URL, all untested:
GitHub Copilot in VS Code (agent mode, via `.vscode/mcp.json`; Copilot
has a free tier), Cursor and Windsurf (AI code editors), Mistral's Le Chat
(browser; plans unclear), LM Studio (runs models on your own computer, no
account; weaker answers, but a different AI using the same val), and
Cloudflare's AI Playground (a test page, no account).

**Asking the AI to install it doesn't work** in claude.ai, ChatGPT or
Gemini. "Please install the MCP server at https://backspaces-mcp.val.run/"
gets you instructions, not a connector. A chat can't change the app's
settings, on purpose: a connector lets the AI act for you, and if chats
could add them, hidden text in a web page the AI was reading could add
one too (prompt injection). Only Claude Code can do it, because it runs
commands on your own machine; that's how it was set up here.

**Val Town isn't the limitation.** Apps only see a URL. Any server would
meet the same limits, wherever it was built. What matters is that it has a
public HTTPS address (claude.ai and Gemini connect from their own
computers) and speaks the standard streamable HTTP transport. Val Town
provides both. A server running on your own computer would do worse: it
would only work with desktop apps.

## Testing locally

Val Town wants `export default handler.fetch`. `deno serve` wants
`export default { fetch }` instead, so to run it locally, use a one-line
wrapper (kept outside the val):

```ts
import f from "./Mcp/http.ts";
Deno.serve({ port: 8787 }, f);
```

## Setting it up

`vt create Mcp ./Mcp --upload-if-exists` created the val but then failed
("File path cannot be empty") before uploading or writing `.vt/`. Fixed by
cloning the empty val elsewhere, moving its `.vt/` into `Mcp/`, and running
`vt push`.

## Verified

- Locally (against the live vals): `tools/list` lists the five tools;
  `list_notes`, `read_note` (and a missing note, which is an error),
  `read_room`, and a bad room name (rejected by the schema) all behaved
  as expected. `post_to_room` to room `mcp-test`, then `read_room`,
  showed the message from `claude`.
- Deployed: `read_note shopping` returned the note, and `watch_status`
  read Watch's new `?json` and reported Rooms and Peers up.
- Claude Code (2026-10-02): added with `claude mcp add` at the default
  local scope, so it's stored in `~/.claude.json` under this project, not
  in the repo. Asking "is everything up?" called `watch_status` and
  answered from it.
- claude.ai (2026-10-05): added with the steps above. The connector page
  listed all five tools, filed under "Other tools", and "What notes do I
  have?" asked to use List notes, then answered shopping and todo. "Say
  mcp rocks in room rooms" posted to the room, and "Read my shopping
  note" asked first, because permissions are per tool.
- After adding the annotations, claude.ai still showed all five under
  "Other tools". It either doesn't group by them or
  kept the tool list from when it connected; not checked by reconnecting,
  which might reset the permissions.
- Codex (2026-10-06, VS Code extension): pasting "Add the MCP server at
  https://backspaces-mcp.val.run/ under the name backspaces…" made Codex
  add `[mcp_servers.backspaces]` with its `url` to `~/.codex/config.toml`;
  in a new chat, "What notes do I have?" listed them.
