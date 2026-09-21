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

Every val gets its own private SQLite database via
`import { sqlite } from "https://esm.town/v/std/sqlite/main.ts"`, shared
by all of that val's files — that's how the email handler and the HTTP
page see the same rows.

Val Town assigns a unique inbound address, customizable via the pencil
icon on the code editor's email badge bar — claimed
[backspaces-mailbox@valtown.email](mailto:backspaces-mailbox@valtown.email).
Send it a test email to trigger the handler, then check with `vt tail`
or [`../scripts/logs.sh`](../scripts/logs.sh) (works for any val, run
from inside its folder).

Limits: 30MB max per inbound email including attachments. No documented
rate limit or spam filtering.
