# Mailbox

Third val — trying the email trigger.

- `email.ts` — logs the sender, subject, body, and any attachment names
  of each incoming message. Uses the documented `emailValHandler` named
  export (not `export default`, unlike the HTTP/cron vals).

Val Town assigns a unique inbound address like `something@valtown.email`
— check the val's page on val.town (pencil icon next to the address) to
see or customize it. Send it a test email to trigger the handler, then
check with `vt tail` or `../Ticker/logs.sh` (copy/adapt — it's generic
enough to work for any val, just point `branch_id` at this one).

Limits: 30MB max per inbound email including attachments. No documented
rate limit or spam filtering.
