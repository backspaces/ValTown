# Watch

Seventh val: an uptime monitor for [Rooms](../Rooms/) and
[Peers](../Peers/). A cron job checks both, remembers the results in blob
storage, and emails you only when something changes: once when a val
goes down, and once when it's back up. New here is **sending** email
([Mailbox](../Mailbox/) only receives it), and cron, blob storage and
email working together.

- `watch.ts`: the checks and the logic, shared by the other two files.
- `cron.ts`: runs the checks on a schedule.
- `http.ts`: a status page, with a **Check now** link.

Three files, one val, one blob: the same "separate triggers, shared
storage" pattern as Mailbox, plus a shared module both triggers import
with a relative path (`import { runChecks } from "./watch.ts"`).

## What counts as up

Each check does a little of the val's real work rather than just loading
a page:

- **Rooms:** reads the room `watch` (`GET /room/watch`) and expects JSON
  with a `messages` list. That goes through Rooms' SQLite database, the
  part most likely to fail.
- **Peers:** fetches `/peers.js` and expects it to contain `join()`.

A check fails on a non-2xx status, a wrong reply, a network error, or
taking longer than 10 seconds (`AbortSignal.timeout`). A failed check is
tried once more 5 seconds later, and only counts if it fails again. Val
Town has occasional one-off errors (Rooms' README describes one), and
they shouldn't cause an email.

To watch something else, add an entry to `targets` in `watch.ts`: a name
and an async function that throws if something's wrong.

## State and email

The blob `watch:status` holds the latest result for each val:

```json
{ "checkedAt": "2026-09-30T20:59:37.202Z",
  "targets": { "Rooms": { "up": true, "since": "2026-09-30T20:59:37.202Z", "problem": null }, ... } }
```

Each run compares its results with the stored ones:

- **Changed** (up → down, or down → up): an email, and `since` resets.
  One email covers every change in that run, with a subject like
  `Watch: Rooms is down`. The back-up email says roughly how long it was
  down.
- **Unchanged:** no email, so a val that stays down doesn't send one every
  run.
- **Seen for the first time** (the very first run, or a newly added
  target): recorded as a starting point, with no email.

`std/email` sends to your Val Town account's address. On the free plan,
that's the only address it can send to, which is all this needs.

## The status page

[backspaces-watch.val.run](https://backspaces-watch.val.run/) shows each
val's state, since when, and the problem if it's down. Times are written
in UTC by the server and converted to your own time zone by a line of
script in the page.

**Check now** (`?check`) runs the checks immediately, at most once a
minute, so the page can't be used to hammer Rooms and Peers. It then
redirects (303) back to the plain page, so reloading doesn't check again.
A check run this way can send an email just like a scheduled one.

## Email delivery: an open problem

As of 2026-10-01, Watch's emails are sent but never arrive.

- **Val Town accepts them.** `std/email` throws unless Val Town replies
  `Email accepted to be sent`, and Watch logs `Emailed: ...` only after
  that. Three sends were accepted: 2026-09-30 21:02:59 and 21:04:09 UTC
  (`Test is down`, `Test is back up`) and a direct test on 2026-10-01
  shortly before 23:00 UTC.
- **They go to the account address,** `owen@backspaces.net`, set on Val
  Town's **Settings → Authentication** page (not the profile page). It
  came from GitHub when the account was created by signing in with
  GitHub. Its **Change email** button failed when tried.
- **That address works for other mail.** It's Namecheap email forwarding;
  a message from iCloud arrived within moments. But nothing from Val Town
  shows up anywhere in Gmail (`in:anywhere val.town`, including spam).
- **Likely cause:** forwarding breaks the sender checks on mail from
  `val.town`, whose DMARC policy (`p=quarantine`) tells receivers to
  distrust mail that fails them. A guess; only Val Town can see whether
  the messages bounced.
- **The free plan can't route around it.** Sending to any other address,
  even this account's own Mailbox val (`backspaces-mailbox@valtown.email`),
  is refused: *"Free tier users can only send email to themselves."*

So the code is treated as correct and left as is, on the assumption that
Val Town will fix delivery. Watch's status page shows the same state the
emails would have reported.

## Setting it up

Two steps that only the web UI can do, as with [Ticker](../Ticker/) and
[Hello](../Hello/):

- **Schedule:** pushing `cron.ts` gives it a default schedule of once an
  hour. It's set to every 15 minutes, the free plan's shortest, with the
  cron expression `*/15 * * * *` (or the interval option). The API
  doesn't report a cron's schedule, so the way to confirm it is to watch
  the status page's "Last checked" time.
- **Subdomain:** `backspaces-watch` is claimed. The email links to it.

## A push-order gotcha

`vt push` uploads files one at a time, and each upload makes a new
version. The first push made version 1 with only `cron.ts`, then
version 2 added `http.ts`, then version 3 added `watch.ts`. A newly
pushed cron runs right away, so it ran against version 1 and failed with
`Module not found ".../Watch@1-main/watch.ts"`. Everything after that
was fine. It only matters on the first push of files that import each
other.

## Verified

- The first check (via **Check now**) recorded Rooms and Peers as up,
  with no email.
- With a temporary third target, `Test`: passing on its first check
  recorded a starting point with no email; pointing it at a URL that
  404s sent `Watch: Test is down`, with the page showing
  `…/nope returned HTTP 404`; pointing it back sent
  `Watch: Test is back up`. Then `Test` was removed.
- The retry is in every one of those checks, so the down email came only
  after both tries failed.
- After the schedule change, `cron.ts` ran at 19:00:02 and 19:15:03 UTC:
  every 15 minutes, on the quarter hour. The old hourly runs had come at
  :59:30. The logs tell scheduled runs from **Check now** runs, because
  each log line records which file produced it (`val.file_id`).
