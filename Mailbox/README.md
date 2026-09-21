# Mailbox

Third val — trying the email trigger.

- `email.ts` — logs the sender, subject, and body of each incoming
  message, and keeps the newest 10 in the val's private SQLite database
  (insert, then delete everything but the last 10 ids). Uses the
  documented `emailValHandler` named export (not `export default`, unlike
  the HTTP/cron vals). Skips attachments for now — `email.attachments` is
  there if we want to revisit it.
- `http.ts` — a second trigger in the same val: a page listing the stored
  emails, newest first. Email content is untrusted input, so it's
  HTML-escaped before rendering.

## Two independent triggers, one database

Neither file calls the other. `email.ts` runs when mail arrives, writes a
row, and finishes. `http.ts` runs whenever its URL is requested (including
the val.town dashboard's preview and App tab), reads the table, and builds
the HTML on the spot. It doesn't run "after" `email.ts`; it just shows
whatever is in the table when you load it. Send an email, reload the page,
and the new row appears.

The only thing connecting them is state. Every val gets its own private
SQLite database via
`import { sqlite } from "https://esm.town/v/std/sqlite/main.ts"`, shared
by all of that val's files. That's the usual Val Town pattern: files in a
val are separate entry points that communicate through storage (SQLite or
blob), not through calls to each other.

The SQLite API is a bit odd: `sqlite.execute()` takes either a plain SQL
string or `{ sql, args }` with `?` placeholders (or named `:params`), and
returns `{ columns, rows, rowsAffected, ... }`. It's documented in Val
Town's [SQLite reference](https://docs.val.town/reference/std/sqlite)
(see its [usage page](https://docs.val.town/reference/std/sqlite/usage)
for examples). To see the data without writing any code, click **SQLite**
in the val's left-hand sidebar: it shows the tables as a browsable grid.

The page only updates on reload; live updates would need polling or
server-sent events.

Tested with mail from both Gmail and iCloud. (A one-off `LibsqlError`
HTTP 500 from the SQLite server showed up on the first page load and
didn't recur on retry, so it looks like a transient val.town hiccup.)

Val Town assigns a unique inbound address, customizable via the pencil
icon on the code editor's email badge bar — claimed
[backspaces-mailbox@valtown.email](mailto:backspaces-mailbox@valtown.email).
Send it a test email to trigger the handler, then check with `vt tail`
or [`../scripts/logs.sh`](../scripts/logs.sh) (works for any val, run
from inside its folder).

Limits: 30MB max per inbound email including attachments. No documented
rate limit or spam filtering.
