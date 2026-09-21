import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

export async function emailValHandler(email) {
  console.log("Email received!", email.from, email.subject, email.text);

  await sqlite.execute(`create table if not exists emails(
    id integer primary key autoincrement,
    received text,
    sender text,
    subject text,
    body text
  )`);
  await sqlite.execute({
    sql: `insert into emails(received, sender, subject, body) values (?, ?, ?, ?)`,
    args: [new Date().toISOString(), email.from, email.subject, email.text],
  });
  await sqlite.execute(
    `delete from emails where id not in (select id from emails order by id desc limit 10)`,
  );
}
