import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default async function () {
  await sqlite.execute(`create table if not exists emails(
    id integer primary key autoincrement,
    received text,
    sender text,
    subject text,
    body text
  )`);
  const { rows } = await sqlite.execute(
    `select * from emails order by id desc`,
  );
  const items = rows.map((r) =>
    `<li><b>${escape(r.subject)}</b> from ${escape(r.sender)}
      <small>${escape(r.received)}</small>
      <pre>${escape(r.body)}</pre></li>`
  ).join("");
  return new Response(
    `<h1>Mailbox: last ${rows.length} emails</h1><ul>${items}</ul>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
