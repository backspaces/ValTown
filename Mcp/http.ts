// An MCP server: lets Claude (or any MCP client) use the other vals as
// tools. Each tool just calls a val's public URL, as a browser would.
// mcp.ts does the MCP part; this file is only the tools.
import { call, mcpServer, z } from "./mcp.ts";

const notesUrl = "https://backspaces-notes.val.run/";
const roomsUrl = "https://backspaces-rooms.val.run/room/";
const watchUrl = "https://backspaces-watch.val.run/?json";
const roomName = z.string().regex(/^[\w-]{1,64}$/)
  .describe('Room name: letters, digits, "_" or "-", e.g. "rooms"');

export default mcpServer({
  list_notes: {
    description: "List the names of all notes in the Notes val.",
    readOnly: true,
    run: async () => (await call(notesUrl)).text(),
  },

  read_note: {
    description: "Read one note from the Notes val, with when it was last updated.",
    readOnly: true,
    args: { name: z.string().min(1).describe('Note name, e.g. "shopping"') },
    run: async ({ name }) => {
      const res = await call(notesUrl + encodeURIComponent(name));
      if (!res) throw new Error(`No note called "${name}".`);
      return res.text();
    },
  },

  list_rooms: {
    description:
      "List the Rooms chat rooms that have messages from the last 24 hours, " +
      "with how many messages and when the latest was sent.",
    readOnly: true,
    run: async () => {
      const { rooms } = await (await call(roomsUrl.replace("/room/", "/rooms"))).json();
      if (!rooms.length) return "No rooms have messages from the last 24 hours.";
      return rooms.map((r) =>
        `${r.room}: ${r.messages} message${r.messages === 1 ? "" : "s"}, latest ${r.last}`
      ).join("\n");
    },
  },

  list_peers: {
    description:
      "List the peers in a Peers room: each browser page that said hello, " +
      "and whether it has said bye. Peers has no presence, so a page that " +
      "closed without its bye still looks present.",
    readOnly: true,
    args: {
      room: roomName.default("peers")
        .describe('Peers room name; defaults to "peers", the demo page\'s room'),
    },
    run: async ({ room }) => {
      const peers = new Map(); // id -> { joined, left }
      let since = 0, more = true;
      while (more) {
        const res = await call(`${roomsUrl}${room}?since=${since}`);
        const page = await res.json();
        for (const { from, data, time } of page.messages) {
          if (data?.type === "hello") peers.set(from, { joined: time });
          if (data?.type === "bye" && peers.has(from)) peers.get(from).left = time;
        }
        ({ last: since, more } = page);
      }
      if (!peers.size) return `No peers have joined room "${room}" in the last 24 hours.`;
      const here = [...peers].filter(([, p]) => !p.left);
      const gone = [...peers].filter(([, p]) => p.left);
      return [
        `Probably here (${here.length}):`,
        ...here.map(([id, p]) => `  ${id}, joined ${p.joined}`),
        `Left (${gone.length}):`,
        ...gone.map(([id, p]) => `  ${id}, joined ${p.joined}, left ${p.left}`),
      ].join("\n");
    },
  },

  read_room: {
    description:
      "Read recent messages in a Rooms chat room (kept for 24 hours), " +
      "and who sent them. Rooms has no presence, so the senders are the " +
      "closest thing to who is in the room.",
    readOnly: true,
    args: {
      room: roomName,
      since: z.number().int().min(0).optional()
        .describe("Only messages with an id above this; omit for all"),
    },
    run: async ({ room, since = 0 }) => {
      const res = await call(`${roomsUrl}${room}?since=${since}`);
      const { messages, last, more } = await res.json();
      if (!messages.length) return `No messages in room "${room}".`;
      const senders = [...new Set(messages.map((m) => m.from))];
      const lines = messages.map((m) =>
        `[${m.id}] ${m.time} ${m.from}${m.to ? " → " + m.to : ""}: ` +
        JSON.stringify(m.data)
      );
      return `Senders: ${senders.join(", ")}\n\n${lines.join("\n")}\n\n` +
        `Last id: ${last}` + (more ? " (more remain: call again with since)" : "");
    },
  },

  post_to_room: {
    description:
      "Send a text message to a Rooms chat room. Anyone with the room " +
      "open in a browser sees it within a second.",
    readOnly: false,
    destructive: false,
    args: {
      room: roomName,
      text: z.string().min(1).max(4000).describe("The message"),
      from: z.string().min(1).max(64).default("claude")
        .describe('Sender name shown in the room; defaults to "claude"'),
    },
    run: async ({ room, text, from }) => {
      const res = await call(roomsUrl + room, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, data: { text } }),
      });
      const { id } = await res.json();
      return `Sent to room "${room}" as ${from} (message id ${id}).`;
    },
  },

  watch_status: {
    description:
      "Get the Watch uptime monitor's latest results: whether each val " +
      "it checks (Rooms, Peers, Rest) is up, since when, and any problem.",
    readOnly: true,
    run: async () => {
      const status = await (await call(watchUrl)).json();
      if (!status) return "Watch has not run any checks yet.";
      const lines = Object.entries(status.targets).map(([name, t]) =>
        `${name}: ${t.up ? "up" : "down"} since ${t.since}` +
        (t.problem ? ` (${t.problem})` : "")
      );
      return `Last checked ${status.checkedAt}\n${lines.join("\n")}`;
    },
  },
});
