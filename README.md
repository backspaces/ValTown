# ValTown

Notes on [Val Town](https://val.town) — a hosted platform for small
TypeScript "vals" (HTTP/cron/email-triggered functions, each with its own
SQLite database and blob store) that deploy instantly, no build step.
Written while getting the toolchain working for real — see
[Creating a val](#creating-a-val) below for the first one.

Companion to the `Apps/` repo, but a separate repo: Val Town hosts and
serves its own code directly (each val gets a live URL), so nothing here
goes through `Apps/`'s WebDAV-to-acequia.io publish pipeline. This repo is
also meant as a home for broader AI-related experiments, not just 1:1 app
ports.

## Layout

One subfolder per val, mirroring `Apps/`'s one-folder-per-app convention:

- [Hello](Hello/) — first val, just proving install → auth → create →
  deploy round-trips before building anything real.
- [Ticker](Ticker/) — second val, trying the cron trigger.
- [Mailbox](Mailbox/) — third val, trying the email trigger.
- [Notes](Notes/) — fourth val, trying blob storage and env vars.
- [Rooms](Rooms/) — fifth val, a shared message relay so browsers can
  talk to each other (and, next, set up WebRTC between themselves).

Plus [scripts/](scripts/) for small utilities that work across any val
(e.g. [`logs.sh`](scripts/logs.sh), for reading a val's log history from
the CLI) — rather than copying them into each val's own folder.

## Installing the `vt` CLI

```sh
deno install -grAf jsr:@valtown/vt
```

Requires Deno 2.9+ (already on this machine, confirmed via `deno --version`).

## Authenticating

Run `vt` and follow the prompt to open `val.town/settings/api`, generating
an API key with **user read, val read+write, telemetry read** permissions.
Needs a real browser, so run this step yourself rather than from a
non-interactive shell.

Alternatively, skip the interactive prompt by setting the key as an env var:

```sh
export VAL_TOWN_API_KEY=<key>
```

Verify setup with `vt --version`.

## Creating a val

```sh
vt create <valName> [targetDir]
```

Creates the val on val.town **and** a matching local folder in one step —
if `targetDir` is omitted, the val name becomes the directory name.

## Everyday commands

- `vt clone [valUri] [targetDir]` — pull an existing val down as a local
  folder (yours or anyone's public one)
- `vt push` — sync local → remote (forceful, no confirmation; undo via the
  website's version history + `vt pull`)
- `vt pull` — sync remote → local (graceful, confirms before discarding
  local changes)
- `vt watch` — auto-push on every save
- `vt status`, `vt browse`, `vt list`, `vt remix`, `vt delete`

## Account

val.town org/account slug: **backspaces** (same as the Deno Deploy org —
see [../Apps/DenoDeploy/README.md](../Apps/DenoDeploy/README.md)). Existing
vals from earlier experiments, before this repo existed: `StorageBlob`,
`StorageAS`, `AntsAS`, `HelloAS`, `FlockAS`.

## GitHub

Also pushed to [github.com/backspaces/ValTown](https://github.com/backspaces/ValTown),
mirroring the `Apps/` repo's convention. Val Town's own per-val version
history (branches + `vt pull`/`vt push`) covers the deployed code for a
single val, but not repo-level things like this README, multiple vals
together, or non-val notes — GitHub is the backup/history for all of that.

Created the repo and pushed the first commit in one step with the
[`gh` CLI](https://cli.github.com/):

```sh
gh repo create backspaces/ValTown --public --source=. --remote=origin --push
```

Requires `gh auth login` beforehand (already done on this machine).

Also enabled GitHub Pages (Settings → Pages, source: `main` branch, root),
serving this README at
[backspaces.github.io/ValTown](https://backspaces.github.io/ValTown/) —
unlike everything else here, done through the web UI rather than the CLI.
Linked from the repo's About section too.

Each val folder's `.vt/` directory (local link + run metadata) is
git-ignored: it's regenerable via `vt clone`, and its `lastRun` field
churns on every command, which would otherwise mean noisy diffs.

## Editor-only TypeScript config

These vals are written as plain JS with a `.ts` extension on purpose
(val.town's HTTP/cron/email type detection keys off `.ts` filenames, so
switching to `.js` wasn't an option). That makes the editor's checker
flag every untyped parameter as `implicitly has an 'any' type`.

Two config files at the repo root exist purely to quiet that, and don't
agree on which is actually responsible: [`deno.json`](deno.json)
(`"strict": false`) is for VS Code's **Deno extension**, if installed and
enabled for the workspace (via `.vscode/settings.json`'s `deno.enable`);
[`tsconfig.json`](tsconfig.json) (also `"strict": false`) is for VS
Code's **built-in** TypeScript checker, which is what turned out to
actually be running here — the status bar showed plain `TypeScript`, no
Deno indicator, even with the Deno config in place. Both are harmless to
keep. All three sit at the repo root, outside every val's own `.vt`-tracked
folder, so `vt push` never sees them — they only affect the editor, never
what's deployed.
