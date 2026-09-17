# Ticker

Second val — trying the cron trigger.

- `cron.ts` — logs a timestamp on each run.

Unlike HTTP vals, the schedule isn't set in code, `vt`, or the REST API
— only the web editor's `+` button (or triple-dots menu next to Run) has
an "Edit schedule" dialog. Turns out pushing a `cron.ts` file auto-assigns
a default schedule (1 hour) rather than leaving it unset, so no manual
step was actually needed — just confirmed/adjusted the interval there.
