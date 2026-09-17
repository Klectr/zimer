# Timekeep

Self-hostable time tracker — a Toggl alternative you own. Bun + HTMX site,
lightweight Manifest V3 browser extension, one SQLite file for all your data.

See [PLAN.md](PLAN.md) for the full plan (architecture, API contract, milestones).

## Quickstart

**Site** (needs [Bun](https://bun.sh)):

```sh
cd site
bun server.ts
# -> http://localhost:3000
# First run prints your API token — save it, the extension needs it.
```

Open http://localhost:3000, paste the token on the login page.

**Extension** (Chrome / Edge / Brave):

1. Go to `chrome://extensions`, enable Developer mode.
2. "Load unpacked" → select the `extension/` folder.
3. Click the Timekeep icon → enter your site URL (e.g. `http://localhost:3000`)
   and the API token → Save.
4. Start/stop timers from the popup. They show up on the site's calendar.

## Layout

```
timekeep/
├── PLAN.md            # the plan: architecture, API, milestones
├── site/
│   ├── server.ts      # the whole backend: API + HTMX pages + SQLite
│   └── static/
│       └── style.css
└── extension/
    ├── manifest.json  # Manifest V3, no build step
    ├── popup.html
    └── popup.js       # vanilla JS: settings, start/stop, live elapsed
```

## Config (env vars)

| Var              | Default        | What                          |
|------------------|----------------|-------------------------------|
| `PORT`           | `3000`         | HTTP port                     |
| `DATA_DIR`       | `site/data`    | SQLite file + token live here |
| `TIMEKEEP_TOKEN` | auto-generated | Shared secret for API + login |
| `TIMEKEEP_BETA`  | `1` (beta)     | Set to `0` to arm post-beta license mode |
| `TIMEKEEP_LICENSE_KEY` | _(none)_ | License key for this install (alternative to Settings) |
| `TIMEKEEP_LICENSE_PUBLIC_KEY` | _(embedded)_ | Override for the license public key (hex) |
| `TIMEKEEP_LICENSE_PRICE` | `$59`    | One-time price shown in the license banner |

## Notes

- **Licensing.** Timekeep is free and full-featured through beta. After beta
  it asks for a one-time license key (Settings → License). The key is
  checked **offline** against an embedded public key — license validation
  never touches the network, and your data never leaves the machine.
  `bun scripts/mint-license.ts` mints keys; the private key stays on the
  seller's machine.
- Times are stored as UTC ISO strings; the site renders them in the server's
  local timezone. If you host on a VPS in another timezone, set `TZ` for the
  process (e.g. `TZ=America/Chicago bun server.ts`).
- Back up `data/timekeep.db` — that's the entire app state.
