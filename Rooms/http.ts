import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

const maxBody = 16 * 1024; // bytes per message
const pageSize = 100; // messages per GET
const keepHours = 24; // older messages are pruned on each POST

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

let ready; // create the table once per isolate, not once per request
const setup = () =>
  ready ??= (async () => {
    await sqlite.execute(`create table if not exists messages(
      id integer primary key autoincrement,
      room text not null,
      sender text not null,
      recipient text,
      body text not null,
      created text not null
    )`);
    await sqlite.execute(
      `create index if not exists messages_room_id on messages(room, id)`,
    );
  })().catch((e) => {
    ready = undefined; // don't cache a failure; retry on the next request
    throw e;
  });

export default async function (req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  if (url.pathname === "/") {
    return new Response(page, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const match = url.pathname.match(/^\/room\/([\w-]{1,64})$/);
  if (!match) return json({ error: "use /room/<name>" }, 404);
  const room = match[1];
  await setup();

  if (req.method === "POST") {
    const text = await req.text();
    if (text.length > maxBody) return json({ error: "message too large" }, 413);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    if (!msg.from || msg.data === undefined) {
      return json({ error: "need {from, data}, optional to" }, 400);
    }
    const created = new Date().toISOString();
    const result = await sqlite.execute({
      sql: `insert into messages(room, sender, recipient, body, created)
            values (?, ?, ?, ?, ?)`,
      args: [room, String(msg.from), msg.to ? String(msg.to) : null,
        JSON.stringify(msg.data), created],
    });
    const cutoff = new Date(Date.now() - keepHours * 3600_000).toISOString();
    await sqlite.execute({
      sql: `delete from messages where created < ?`,
      args: [cutoff],
    });
    return json({ id: Number(result.lastInsertRowid), time: created });
  }

  if (req.method === "GET") {
    const since = Number(url.searchParams.get("since") ?? 0) || 0;
    const me = url.searchParams.get("me");
    const { rows } = await sqlite.execute({
      sql: `select * from messages
            where room = ? and id > ?
              and (recipient is null or recipient = ? or sender = ?)
            order by id limit ?`,
      args: [room, since, me, me, pageSize],
    });
    const messages = rows.map((r) => ({
      id: r.id,
      from: r.sender,
      to: r.recipient,
      data: JSON.parse(r.body),
      time: r.created,
    }));
    const last = messages.length ? messages.at(-1).id : since;
    return json({ messages, last, more: messages.length === pageSize });
  }

  return json({ error: "use GET or POST" }, 405);
}

// A tiny test client: open it in two tabs and chat.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rooms</title>
<style>
  body { font: 15px system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
  #log { border: 1px solid #ccc; height: 50vh; overflow-y: auto; padding: .5rem; }
  #log div { margin: .2rem 0; white-space: pre-wrap; }
  .me { color: #06c; }
  small { color: #888; }
  form { display: flex; gap: .5rem; margin-top: .5rem; align-items: flex-end; }
  #text { flex: 1; font: 13px ui-monospace, monospace; resize: vertical; }
</style>
</head>
<body>
<h1>Room <code id="room"></code></h1>
<p>You are <b id="me"></b>. Open this page in another tab (same <code>?room=</code>) to chat.</p>
<div id="log"></div>
<form id="form"><textarea id="text" rows="4" placeholder="Text or JSON. Ctrl+Enter (⌘+Enter on Mac) sends."></textarea><button>Send</button></form>
<script type="module">
const room = new URLSearchParams(location.search).get("room") || "lobby";
const me = sessionStorage.me ||= "peer-" + Math.random().toString(36).slice(2, 7);
const base = location.origin + "/room/" + room;
let since = 0;

document.getElementById("room").textContent = room;
document.getElementById("me").textContent = me;
const log = document.getElementById("log");

// Plain text arrives as {text}; anything else is shown as pretty JSON.
function describe(data) {
  const isText = data && typeof data.text === "string" && Object.keys(data).length === 1;
  return isText ? data.text : JSON.stringify(data, null, 2);
}

function show(m) {
  const div = document.createElement("div");
  div.className = m.from === me ? "me" : "";
  div.textContent = m.from + ": " + describe(m.data) + " ";
  const time = document.createElement("small");
  time.textContent = new Date(m.time).toLocaleTimeString();
  div.append(time);
  log.append(div);
  log.scrollTop = log.scrollHeight;
}

async function poll() {
  try {
    const res = await fetch(base + "?since=" + since + "&me=" + me);
    const { messages, last, more } = await res.json();
    messages.forEach(show);
    since = last;
    if (more) return poll();
  } catch (e) {
    console.warn("poll failed", e);
  }
  setTimeout(poll, 1000);
}

const form = document.getElementById("form");
const input = document.getElementById("text");
input.onkeydown = (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit();
};

// Valid JSON is sent as the message data itself; anything else as {text}.
function toData(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { text: value };
  }
}

form.onsubmit = async (e) => {
  e.preventDefault();
  if (!input.value.trim()) return;
  await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: me, data: toData(input.value) }),
  });
  input.value = "";
};

poll();
</script>
</body>
</html>`;
