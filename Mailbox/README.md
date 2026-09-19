# Mailbox

Third val — trying the email trigger.

- `email.ts` — logs the sender, subject, and body of each incoming
  message. Uses the documented `emailValHandler` named export (not
  `export default`, unlike the HTTP/cron vals). Skips attachments for
  now — `email.attachments` is there if we want to revisit it.

Val Town assigns a unique inbound address, customizable via the pencil
icon on the code editor's email badge bar — claimed
[backspaces-mailbox@valtown.email](mailto:backspaces-mailbox@valtown.email).
Send it a test email to trigger the handler, then check with `vt tail`
or `../Ticker/logs.sh` (copy/adapt — it's generic enough to work for any
val, just point `branch_id` at this one).

Limits: 30MB max per inbound email including attachments. No documented
rate limit or spam filtering.
