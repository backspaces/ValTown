import { blob } from "https://esm.town/v/std/blob/main.ts";

export default async function (req) {
  if (req.method === "POST") {
    const password = Deno.env.get("NOTES_PASSWORD");
    if (!password) {
      return new Response("NOTES_PASSWORD env var is not set", { status: 500 });
    }
    if (req.headers.get("x-password") !== password) {
      return new Response("Wrong password", { status: 401 });
    }
    const text = await req.text();
    await blob.setJSON("note", { text, updated: new Date().toISOString() });
    return new Response("Saved");
  }

  const note = await blob.getJSON("note");
  if (!note) return new Response("(no note yet)");
  return new Response(`${note.text}\n\n(updated ${note.updated})`);
}
