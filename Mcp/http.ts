// An MCP server: lets Claude (or any MCP client) use the other vals as
// tools. Each tool just calls a val's public URL, as a browser would.
import {
  createMcpHandler,
  McpServer,
} from "npm:@modelcontextprotocol/server@2";
import * as z from "npm:zod@4/v4";

const notesUrl = "https://backspaces-notes.val.run/";
const roomsUrl = "https://backspaces-rooms.val.run/room/";
const watchUrl = "https://backspaces-watch.val.run/?json";
const timeoutMs = 10_000;
const roomName = z.string().regex(/^[\w-]{1,64}$/)
  .describe('Room name: letters, digits, "_" or "-", e.g. "rooms"');

// Hints telling clients (claude.ai, say) which tools only read, and that
// post_to_room adds a message but never deletes or overwrites anything.
const readOnly = { readOnlyHint: true };
const addsOnly = { readOnlyHint: false, destructiveHint: false };

const text = (s) => ({ content: [{ type: "text", text: s }] });
const failed = (s) => ({ ...text(s), isError: true });

// Like fetch, but gives up after timeoutMs, and returns null (instead of
// throwing) on a 404, so tools can say "no such ..." themselves.
async function call(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}: ${await res.text()}`);
  return res;
}

// Turn a thrown error into a tool result the model can read, rather than
// a protocol error.
const safely = (tool) => async (args) => {
  try {
    return await tool(args);
  } catch (e) {
    return failed(e.message ?? String(e));
  }
};

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "backspaces", version: "1.0.0" });

  server.registerTool("list_notes", {
    annotations: readOnly,
    description: "List the names of all notes in the Notes val.",
    inputSchema: z.object({}),
  }, safely(async () => text(await (await call(notesUrl)).text())));

  server.registerTool("read_note", {
    annotations: readOnly,
    description: "Read one note from the Notes val, with when it was last updated.",
    inputSchema: z.object({
      name: z.string().min(1).describe('Note name, e.g. "shopping"'),
    }),
  }, safely(async ({ name }) => {
    const res = await call(notesUrl + encodeURIComponent(name));
    return res ? text(await res.text()) : failed(`No note called "${name}".`);
  }));

  server.registerTool("read_room", {
    annotations: readOnly,
    description:
      "Read recent messages in a Rooms chat room (kept for 24 hours), " +
      "and who sent them. Rooms has no presence, so the senders are the " +
      "closest thing to who is in the room.",
    inputSchema: z.object({
      room: roomName,
      since: z.number().int().min(0).optional()
        .describe("Only messages with an id above this; omit for all"),
    }),
  }, safely(async ({ room, since = 0 }) => {
    const res = await call(`${roomsUrl}${room}?since=${since}`);
    const { messages, last, more } = await res.json();
    if (!messages.length) return text(`No messages in room "${room}".`);
    const senders = [...new Set(messages.map((m) => m.from))];
    const lines = messages.map((m) =>
      `[${m.id}] ${m.time} ${m.from}${m.to ? " → " + m.to : ""}: ` +
      JSON.stringify(m.data)
    );
    return text(
      `Senders: ${senders.join(", ")}\n\n${lines.join("\n")}\n\n` +
        `Last id: ${last}` + (more ? " (more remain: call again with since)" : ""),
    );
  }));

  server.registerTool("post_to_room", {
    annotations: addsOnly,
    description:
      "Send a text message to a Rooms chat room. Anyone with the room " +
      "open in a browser sees it within a second.",
    inputSchema: z.object({
      room: roomName,
      text: z.string().min(1).max(4000).describe("The message"),
      from: z.string().min(1).max(64).default("claude")
        .describe('Sender name shown in the room; defaults to "claude"'),
    }),
  }, safely(async ({ room, text: message, from }) => {
    const res = await call(roomsUrl + room, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, data: { text: message } }),
    });
    const { id } = await res.json();
    return text(`Sent to room "${room}" as ${from} (message id ${id}).`);
  }));

  server.registerTool("watch_status", {
    annotations: readOnly,
    description:
      "Get the Watch uptime monitor's latest results: whether each val " +
      "it checks (Rooms, Peers) is up, since when, and any problem.",
    inputSchema: z.object({}),
  }, safely(async () => {
    const status = await (await call(watchUrl)).json();
    if (!status) return text("Watch has not run any checks yet.");
    const lines = Object.entries(status.targets).map(([name, t]) =>
      `${name}: ${t.up ? "up" : "down"} since ${t.since}` +
      (t.problem ? ` (${t.problem})` : "")
    );
    return text(`Last checked ${status.checkedAt}\n${lines.join("\n")}`);
  }));

  return server;
});

// A browser visit (a GET that doesn't ask for an event stream) gets a
// note for people, on what this is and how to use it, instead of the
// SDK's "Method not allowed".
const note = (url) => `Backspaces MCP server

This address is for AI assistants, not for browsers. Add it to Claude,
and Claude can use these tools on the backspaces vals:

  List notes      the names of the notes in Notes
  Read note       one note
  Read room       recent messages in a Rooms chat room
  Post to room    send a message to a Rooms chat room
  Watch status    whether Watch says Rooms and Peers are up

Then ask in plain words, e.g. "What notes do I have?"

In claude.ai (any plan; Free allows one custom connector):
  1. Customize → Connectors → + Add → Custom
  2. Name: backspaces    MCP server URL: ${url}
  3. Continue, leave "No sign-in", then Add
  4. On the connector's page, click Connect
  To find it again later: Customize → Connectors → Yours.

In Claude Code or Codex, paste this into a chat, then start a new chat:
  Add the MCP server at ${url} under the name backspaces,
  available in all my projects.
Or run the command yourself:
  claude mcp add --transport http --scope user backspaces ${url}
  codex mcp add backspaces --url ${url}

More, and how it works: https://www.val.town/x/backspaces/Mcp
`;

export default (req) =>
  req.method === "GET" &&
    !req.headers.get("accept")?.includes("text/event-stream")
    ? new Response(note(new URL(req.url).origin + "/"))
    : handler.fetch(req);
