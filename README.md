<div align="center">

# Timekeep

Self-hostable time tracker — timer → invoice. One Bun server, one SQLite file, your data never leaves the machine.

</div>

<details>
<summary><kbd>Table of contents</kbd></summary>

- [Features](#features)
- [Install](#install)
- [Quickstart](#quickstart)
- [Browser extension](#browser-extension)
- [Config](#config)
- [Notes](#notes)
- [Layout](#layout)
- [Development](#development)
- [Docs](#docs)
- [License](#license)

</details>

## Features

- **Timer** — one-tap start/stop, live elapsed, notes, projects.
- **Calendar** — Toggl-style week grid, drag to create entries, edit in place.
- **Invoicing** — pick a date range, edit line items, draft → sent → paid, download the PDF. Sent invoices are frozen snapshots.
- **Revenue** — totals, trailing-12-month chart, per-client breakdown.
- **Public invoice links** — read-only shareable page per invoice (optional Stripe payment link).
- **Browser extension** — start/stop timers from the Chrome / Edge / Brave toolbar, no build step.
- **Check for updates** — in-app, from the signed release feed.
- **Offline license** — free and full-featured through beta; post-beta takes a one-time key checked entirely offline against an embedded public key. No network call, no telemetry.
- Your data is one SQLite file. Back it up, move it, done.

## Install

Needs [Bun](https://bun.sh), `curl`, `tar`, `sha256sum`. Installs to `/opt/timekeep` (needs root; set `INSTALL_DIR` to change).

```sh
curl -fsSL https://invoices.tristonarmstrong.com/releases/install.sh | bash
# re-running the same command updates to the latest v1 release —
# data, token, and start.sh are preserved
```

## Quickstart

From source:

```sh
bun run ./site/server.ts
# -> http://127.0.0.1:3000
```

First run prints your API token — save it; the login page and the extension both need it. Binds localhost only by default; set `HOST`/`PORT` to change that.

## Browser extension

Chrome / Edge / Brave:

1. `chrome://extensions` → enable Developer mode → "Load unpacked" → the `extension/` folder.
2. Click the Timekeep icon → enter your site URL (e.g. `http://localhost:3000`) and the API token → Save.
3. Start/stop timers from the popup. They show up on the site's calendar.

## Config

| Var                            | Default        | What                                          |
|--------------------------------|----------------|-----------------------------------------------|
| `PORT`                         | `3000`         | HTTP port                                     |
| `HOST`                         | `127.0.0.1`    | bind address                                  |
| `DATA_DIR`                     | `site/data`    | SQLite file + token live here                 |
| `TIMEKEEP_TOKEN`               | auto-generated | shared secret for API + login                 |
| `TIMEKEEP_BETA`                | `1` (beta)     | set to `0` to arm post-beta license mode      |
| `TIMEKEEP_LICENSE_KEY`         | _(none)_       | license key for this install (or set in Settings) |
| `TIMEKEEP_LICENSE_PUBLIC_KEY`  | _(embedded)_   | override for the license public key (hex)     |
| `TIMEKEEP_LICENSE_PRICE`       | `$59`          | one-time price shown in the license banner    |

## Notes

- Times are stored as UTC ISO strings; the site renders them in the server's local timezone. If you host on a VPS in another timezone, set `TZ` for the process (e.g. `TZ=America/Chicago bun run ./site/server.ts`).
- Back up `data/timekeep.db` — that's the entire app state.

## Layout

```
timekeep/
├── AGENTS.md            # the always-known rules: Bun-only, M3 dark, workflows
├── PLAN.md              # the plan: architecture, API contract, milestones
├── CHANGELOG.md         # what's new, newest first
├── LICENSE              # MIT
├── VERSION
├── install.sh           # one-command install / updater
├── site/
│   ├── server.ts        # entry: HTTP server + SQLite
│   ├── db.ts            # schema + migrations
│   ├── pdf.ts           # zero-dependency PDF writer
│   ├── stripe.ts        # optional Stripe payment link on invoices
│   ├── routes/          # web.ts (HTMX pages), api.ts (JSON API)
│   ├── views/           # timer, calendar, invoices, manage, public pages
│   ├── lib/             # auth, license, revenue, icons, updates, ...
│   └── static/          # style.css, dialog.js, shortcut.js, ...
└── extension/           # Manifest V3, no build step: manifest.json, popup.html, popup.js, bg.js
```

## Development

Bun only — no npm/npx/yarn/pnpm/Docker.

```sh
bun test        # must finish with 0 failures
```

Every change goes issue → early PR → test evidence → merge. See [docs/workflow.md](docs/workflow.md).

## Docs

- [AGENTS.md](AGENTS.md) — architecture, hard rules, design philosophy, settled decisions, workflows
- [docs/design-system.md](docs/design-system.md) — the M3 Expressive spec the UI follows
- [docs/workflow.md](docs/workflow.md) — the issue → PR change process
- [PLAN.md](PLAN.md) — original plan: architecture, API contract, milestones
- [CHANGELOG.md](CHANGELOG.md) — release notes

## License

[MIT](LICENSE) © 2026 tristonarmstrong
