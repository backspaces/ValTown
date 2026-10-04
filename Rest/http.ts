// A small, textbook REST API: one collection, /items, of JSON items that
// anyone can read and write. Made for the Browser repo's REST topic.
import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

const maxBody = 4 * 1024; // bytes per item
const maxItems = 500; // in the whole collection
const listSize = 100; // items per GET /items
const keepHours = 24; // items not updated for this long are deleted

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE",
  "access-control-allow-headers": "content-type",
  "access-control-expose-headers": "location, allow, vary",
};

let ready; // create the table once per isolate, as in Rooms
const setup = () =>
  ready ??= sqlite.execute(`create table if not exists items(
    id text primary key,
    body text not null,
    created text not null,
    updated text not null
  )`).catch((e) => {
    ready = undefined;
    throw e;
  });

// What GET / returns: the API describing itself.
const about = {
  name: "Rest",
  about: "A small REST API for trying out HTTP methods. Items are any " +
    `JSON up to ${maxBody} bytes, and are deleted after ${keepHours} ` +
    "hours without an update. Anyone can read and write them.",
  items: "/items",
  methods: {
    "GET /items": "list the most recently updated items",
    "POST /items": "add an item; the server picks its id (201 + Location)",
    "GET /items/<id>": "read one item (404 if there's none)",
    "PUT /items/<id>": "create (201) or replace (200) the item with that id",
    "DELETE /items/<id>": "remove it (204, or 404)",
  },
  formats: "JSON by default; HTML for requests that accept text/html",
  source: "https://www.val.town/x/backspaces/Rest",
};

const escape = (s) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// The same data as a page, for browsers: the JSON, with its links clickable.
const page = (value) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rest</title>
<body style="font: 14px ui-monospace, monospace; margin: 1rem">
<p><a href="/">Rest</a> · <a href="/items">/items</a></p>
<pre style="white-space: pre-wrap">${
  escape(JSON.stringify(value, null, 2))
    .replace(/"(\/items(?:\/[\w-]+)?)"/g, '"<a href="$1">$1</a>"')
}</pre>`;

// Every response goes through here: JSON or HTML, chosen by the request's
// accept header, with no body for HEAD (or when there's no value).
function reply(req, status, value, headers = {}) {
  const head = { ...cors, vary: "accept", ...headers };
  if (value === undefined) return new Response(null, { status, headers: head });
  const html = req.headers.get("accept")?.includes("text/html");
  head["content-type"] = html ? "text/html; charset=utf-8" : "application/json";
  const body = html ? page(value) : JSON.stringify(value, null, 2);
  return new Response(req.method === "HEAD" ? null : body, { status, headers: head });
}

// A stored row as the outside world sees it, including its own URL.
const show = (row) => ({
  id: row.id,
  url: `/items/${row.id}`,
  data: JSON.parse(row.body),
  created: row.created,
  updated: row.updated,
});

const find = async (id) =>
  (await sqlite.execute({ sql: `select * from items where id = ?`, args: [id] }))
    .rows[0];

// The request's JSON body as { data }, or a Response saying what's wrong.
async function readBody(req) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return reply(req, 415, { error: "send JSON, with content-type: application/json" });
  }
  const text = await req.text();
  if (text.length > maxBody) return reply(req, 413, { error: `over ${maxBody} bytes` });
  try {
    return { data: JSON.parse(text) };
  } catch {
    return reply(req, 400, { error: "the body isn't valid JSON" });
  }
}

// Create or replace one item. `old` is its current row, if it has one.
async function store(req, id, data, old) {
  if (!old) {
    const { rows } = await sqlite.execute(`select count(*) as n from items`);
    if (rows[0].n >= maxItems) {
      return reply(req, 507, { error: "the collection is full; try again later" });
    }
  }
  const now = new Date().toISOString();
  const body = JSON.stringify(data);
  await sqlite.execute({
    sql: `insert into items(id, body, created, updated) values (?, ?, ?, ?)
          on conflict(id) do update set body = excluded.body, updated = excluded.updated`,
    args: [id, body, now, now],
  });
  const item = show({ id, body, created: old?.created ?? now, updated: now });
  return old ? reply(req, 200, item) : reply(req, 201, item, { location: item.url });
}

// One handler per method, for each kind of resource. Their keys are also
// what a 405's allow header lists.
const root = {
  GET: (req) => reply(req, 200, about),
  HEAD: (req) => reply(req, 200, about),
};

const collection = {
  async GET(req) {
    const { rows } = await sqlite.execute({
      sql: `select * from items order by updated desc limit ?`,
      args: [listSize],
    });
    return reply(req, 200, { items: rows.map(show) });
  },
  HEAD: (req) => collection.GET(req),
  async POST(req) {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    return store(req, crypto.randomUUID().slice(0, 8), body.data);
  },
};

const item = {
  async GET(req, id) {
    const row = await find(id);
    return row ? reply(req, 200, show(row)) : reply(req, 404, { error: `no item ${id}` });
  },
  HEAD: (req, id) => item.GET(req, id),
  async PUT(req, id) {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    return store(req, id, body.data, await find(id));
  },
  async DELETE(req, id) {
    const { rowsAffected } = await sqlite.execute({
      sql: `delete from items where id = ?`,
      args: [id],
    });
    return rowsAffected ? reply(req, 204) : reply(req, 404, { error: `no item ${id}` });
  },
};

function route(req, methods, id) {
  const handler = methods[req.method];
  if (handler) return handler(req, id);
  const allow = Object.keys(methods).join(", ");
  return reply(req, 405, { error: `${req.method} isn't allowed here; use ${allow}` }, { allow });
}

export default async function (req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const { pathname } = new URL(req.url);
  await setup();
  const cutoff = new Date(Date.now() - keepHours * 3600_000).toISOString();
  await sqlite.execute({ sql: `delete from items where updated < ?`, args: [cutoff] });

  if (pathname === "/") return route(req, root);
  if (pathname === "/items") return route(req, collection);
  const match = pathname.match(/^\/items\/([\w-]{1,64})$/);
  if (match) return route(req, item, match[1]);
  return reply(req, 404, { error: "nothing here; try /items" });
}
