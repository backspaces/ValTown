import { blob } from "https://esm.town/v/std/blob/main.ts";

const prefix = "note:";
const keyFor = (name) => prefix + name;
const nameFrom = (item) => item.key.slice(prefix.length);

export default async function (req) {
  const url = new URL(req.url);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (req.method === "POST") {
    if (!name) {
      return new Response("POST needs a note name in the path, e.g. /shopping", { status: 400 });
    }
    const password = Deno.env.get("NOTES_PASSWORD");
    if (!password) {
      return new Response("NOTES_PASSWORD env var is not set", { status: 500 });
    }
    if (req.headers.get("x-password") !== password) {
      return new Response("Wrong password", { status: 401 });
    }
    const text = await req.text();
    await blob.setJSON(keyFor(name), { text, updated: new Date().toISOString() });
    return new Response("Saved");
  }

  if (!name) {
    const list = await blob.list(prefix);
    const names = list.map(nameFrom);
    return new Response(names.length ? names.join("\n") : "(no notes yet)");
  }

  const note = await blob.getJSON(keyFor(name));
  if (!note) return new Response("(no such note)", { status: 404 });
  return new Response(`${note.text}\n\n(updated ${note.updated})`);
}
