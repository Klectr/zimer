# Timekeep — Plan

Self-hostable Toggl replacement. You own the server, you own the data (one SQLite file).
MVP goal: **start tracking time from the extension or the site, and see it on a calendar.**

## Architecture

```
┌──────────────────┐      JSON + Bearer token      ┌─────────────────────────┐
│ Browser extension │ ◄──────────────────────────► │ Site (Bun)              │
│ Manifest V3       │                               │  · REST API (JSON)      │
│ vanilla JS,       │      cookie session           │  · HTMX pages (HTML)    │
│ no build step     │ ◄──────────────────────────► │  · SQLite (bun:sqlite)  │
└──────────────────┘                               └─────────────────────────┘
```

One deployment: `bun server.ts` + one `timekeep.db` file. The extension points at
whatever URL you self-host (localhost, home server, VPS — runtime host permission).

## Tech choices

| Piece     | Choice                        | Why                                                        |
|-----------|-------------------------------|------------------------------------------------------------|
| Site      | **Bun** (`Bun.serve`)         | Runtime + server + SQLite driver in one binary, zero deps |
| UI        | **HTMX** (CDN)                | Server-rendered HTML partials, no frontend build          |
| DB        | **bun:sqlite** (WAL mode)     | Single file, zero config, survives restarts                |
| Extension | **Vanilla JS, Manifest V3**   | Lightest option: no bundler, no framework, load unpacked   |
| Auth      | Shared token                  | `TIMEKEEP_TOKEN` env or auto-generated; Bearer for API, HttpOnly cookie for pages |

## Data model

- `clients(id, name, color)` — e.g. BYTEBOT, Upwork clients
- `projects(id, client_id, name)`
- `time_entries(id, project_id, description, start_time, end_time)` — `end_time NULL` = running

## API contract (all under `/api`, Bearer token)

- `GET /api/status` → `{ running: entry | null }`
- `POST /api/timer/start` `{ description?, project_id? }` → `201 entry` (`409` if one running)
- `POST /api/timer/stop` → `200 entry` (`404` if none running)
- `GET /api/entries?from=ISO&to=ISO` → `entry[]` (each with `duration_seconds`)
- `PATCH /api/entries/:id` `{ description?, project_id?, start_time?, end_time? }`
- `DELETE /api/entries/:id` → `204`
- `GET/POST /api/clients`, `DELETE /api/clients/:id`
- `GET/POST /api/projects`, `DELETE /api/projects/:id`

Entry shape: `{ id, project_id, description, start_time, end_time, duration_seconds,
project_name, client_name, client_color }`.

## Pages (HTMX, cookie session)

- `/` — dashboard: timer card (start/stop) + today's entries
- `/calendar` — week view (Mon–Sun), entries per day, day/week totals, prev/next week
- `/entries/:id/edit` — fix a description, project, or times after the fact
- `/manage` — clients & projects CRUD
- `/login` — paste the token once, get a session cookie

## Milestones

- **M0 — scaffold (this commit):** repo, plan, running site, loadable extension,
  start/stop round-trips end to end.
- **M1 — trackable:** calendar week view polished, entry editing solid, extension
  shows running timer reliably. → *"ready to start tracking time on a calendar."*
- **M2 — useful:** per-client/project weekly reports, CSV export, extension badge
  shows running state, keyboard shortcut to start/stop.
- **M3 — later, maybe:** multi-user, PWA/mobile, idle detection, invoicing.

## Non-goals for MVP

Teams, billing/invoices, native mobile apps, desktop apps, idle detection,
screenshot monitoring (never).

## Self-hosting

```sh
cd site
bun server.ts            # -> http://localhost:3000, token printed on first run
```

`PORT`, `DATA_DIR`, `TIMEKEEP_TOKEN` env vars. For a server: run under systemd
(or `docker` later), put Caddy/nginx in front for HTTPS, point the extension at
your URL. Back up `data/timekeep.db` — that's everything.
