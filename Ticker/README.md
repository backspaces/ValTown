# Ticker

Second val — trying the cron trigger.

- `cron.ts` — logs a timestamp on each run.

Unlike HTTP vals, the schedule isn't set in code, `vt`, or the REST API
— only the web editor's `+` button (or triple-dots menu next to Run) has
an "Edit schedule" dialog. Turns out pushing a `cron.ts` file auto-assigns
a default schedule (1 hour) rather than leaving it unset, so no manual
step was actually needed to get it running — just confirmed/adjusted the
interval there.

## Schedule syntax

Switching the dialog's Format to "Cron" accepts a standard 5-field cron
expression, always evaluated in **UTC**:

![Edit schedule dialog, cron expression `*/15 9-17 * * 1-5`](edit-schedule.png)

```
*/15 9-17 * * 1-5
```

Every 15 minutes, 9am–5pm, Monday–Friday, UTC — a "business hours"
ticker instead of the flat default interval. 15 minutes is also the
shortest interval allowed on the free tier (Pro accounts can go down to
once a minute).

## Reading logs from the CLI

`vt tail` streams a val's logs live, but only forward from the moment you
run it — it won't show history. For "what already happened," `vt` has no
built-in command, but val.town's REST API does:
[`GET /v1/telemetry/logs`](https://api.val.town/documentation), authenticated
with the same API key `vt` stores (`vt config get apiKey`).

`logs.sh` wraps that into a one-liner — last N log lines, newest first:

```sh
./logs.sh        # last 5 (default)
./logs.sh 20     # last 20
```
