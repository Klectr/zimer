# Hosted ops baseline (#730)

What keeps the hosted tier alive and reachable. Part 1 covered the health
endpoint, privacy page, terms, and support channel; part 2 added automated
per-customer backups (this doc).

## Health endpoint

`GET /health` — no auth, no rate limit. Returns `200`:

```json
{ "ok": true }
```

That's the whole payload (#989): version, backup timestamps, and tenant
counts were reconnaissance for anyone who asked, so they no longer ride
along. If `/health` doesn't answer, the server is down or unreachable —
nothing fancier to check first.

## Error tracking (#1023)

Exceptions land in PostHog's Error tracking: browser errors via the
snippet's exception autocapture (attached to the session replay), and
unhandled server errors via the Bun.serve error handler POSTing an
$exception event (distinct id `zimer-server`). Both are gated on
POSTHOG_KEY, so they exist only where analytics does. Server errors are
also still logged to stderr; triage in PostHog, where the issue groups
them and carries the stack.

## External uptime monitoring

We don't monitor ourselves from the same box. Set up an external check
before charging anyone:

- **What:** HTTP check against `GET /health`, every 5 minutes, from at
  least two regions.
- **Alert when:** non-200, or `ok` isn't `true`, or the check fails twice
  in a row.
- **Where to alert:** email to `support@klectr.dev` plus one on-call
  channel (SMS/push).
- **Recommended:** UptimeRobot (free tier covers this fine), or Better
  Uptime / Oh Dear if you want status-page and incident workflows in one.
  Anything that can hit a URL and send an alert works — the endpoint is
  deliberately trivial.

## What to watch

Beyond "is it up":

- **Port:** the app binds `127.0.0.1:$PORT` behind nginx (`PORT=8080` in
  production). If `/health` 502s but the box answers SSH, the app process
  likely died — restart via `/opt/timekeep/start.sh` (all runtime env lives
  there).
- **Disk:** one SQLite file in WAL mode; invoice PDFs are generated on
  demand, not stored. Alert at 80% on the data volume — a full disk is
  the most likely way a SQLite app dies.
- **Backup freshness:** automated per-customer backups run on the server
  (below). `/health` no longer reports freshness (#989) — alert on the
  backup files themselves: the newest file under `DATA_DIR/backups/` (and
  the newest `backups/accounts-*.db`) must be under 24h old. Any file-age
  check works, e.g. `find /opt/zimer-dev/data/backups -type f -mmin -1440`.
- **TLS/cert:** Cloudflare terminates TLS. If browsers report cert
  errors but `/health` is fine, it's the Cloudflare edge, not us.

## Backups (part 2 of #730)

Hosted mode only (`HOSTED=1`). Each tenant's SQLite file is copied with
`VACUUM INTO` (a consistent, compacted snapshot of the live database — no
downtime, safe against WAL):

- `DATA_DIR/backups/<user_id>/zimer-<UTC-timestamp>.db` — per customer.
- `DATA_DIR/backups/accounts-<UTC-timestamp>.db` — the accounts control
  plane, backed up **separately and never into a tenant's folder**.
  accounts.db holds password hashes and session tokens; treat it like a
  secret — encrypt at rest and restrict who can copy the backups volume.

Retention: one backup per UTC day, newest kept, 7 days; older days are
pruned automatically after each pass (see `site/lib/backups.ts`).
Schedule: one pass 60s after boot, then every `BACKUP_INTERVAL_HOURS`
(default 6). A per-tenant failure is logged, never throws — one broken
customer file doesn't stop the rest of the fleet.

### Runbook: restore one customer from backup

1. Stop the app: on the box, kill the `bun site/server.ts` process (by
   captured PID — never `pkill -f`) so no handle is writing the tenant
   file.
2. Pick the backup to restore from `DATA_DIR/backups/<user_id>/`
   (newest `zimer-<UTC-timestamp>.db` unless you have a reason to go
   older) and copy it over `DATA_DIR/<user_id>.db`.
3. Restart via `setsid /opt/timekeep/start.sh`, re-check `/health`.
4. Same steps for `accounts-<UTC-timestamp>.db` → `DATA_DIR/accounts.db`
   if the control plane is what's broken — mind that it holds live
   session tokens.

## Support channel

`support@klectr.dev` — linked at the bottom of Settings in the app, and
named in the terms and privacy policy as the deletion/refund contact.
One inbox, one human. Reply within one business day.

## Runbook: the app is down

1. `curl` the public `/health`. Non-200 or timeout → SSH to the box.
2. Is the app process listening? `ss -tlnp | grep 8080` (production port).
   No → restart: `setsid /opt/timekeep/start.sh`, then re-check `/health`.
3. Disk full? `df -h` on the data volume.
4. nginx serving stale config after a reload? Verify the 8080 listeners
   are back before calling it done.
5. Still down → check recent deploys; roll back to the previous tarball
   in `/opt/timekeep` and restart.

## Changelog discipline

Any ops-affecting change (new env var, new port, new cron, monitoring
target) gets a line here and in the changelog. Future-you is on call.

- 2026-10-03 (#730 part 2): automated per-customer backups — `VACUUM INTO`
  to `DATA_DIR/backups/<user_id>/`, accounts separately to
  `DATA_DIR/backups/accounts-<ts>.db`, 7-day daily retention, 60s-after-boot
  + every `BACKUP_INTERVAL_HOURS` (default 6; 0 disables) in hosted mode
  only, freshness on `GET /health` as `backups.accounts`/`backups.tenants`
  (removed by #989 — freshness is monitored on the backup files directly).
- 2026-10-20 (#986): session tokens are stored in accounts.db as SHA-256
  hashes; the first boot of the new build rewrites existing rows in place
  (guarded by `PRAGMA user_version`). Two hazards: (1) rolling back across
  this migration strands any raw sessions the old build mints afterwards —
  they can never be re-hashed (indistinguishable from digests) and their
  owners get logged out on the next forward deploy; (2) restoring
  accounts.db from a `sqlite .dump` loses `user_version`, so the migration
  re-runs and invalidates all live sessions (they self-heal at next login).
  Prefer `VACUUM INTO` backups, which preserve it.
