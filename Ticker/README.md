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
