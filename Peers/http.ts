// Serves the demo page and the peers.js module. Both are ordinary files
// in this val, read back from esm.town (where every val file is
// published) instead of being pasted into this code as strings.
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/peers.js": ["peers.js", "text/javascript; charset=utf-8"],
};

export default async function (req) {
  const entry = files[new URL(req.url).pathname];
  if (!entry) return new Response("Not found", { status: 404 });
  const [name, type] = entry;
  const res = await fetch(new URL(name, import.meta.url));
  if (!res.ok) return new Response(`Couldn't read ${name}`, { status: 502 });
  return new Response(await res.text(), {
    headers: { "content-type": type, "access-control-allow-origin": "*" },
  });
}
