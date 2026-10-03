# Hosted ops baseline (#730)

What keeps the hosted tier alive and reachable. Part 1 of #730; per-customer
backups are part 2 (separate issue/worker).

## Health endpoint

`GET /health` — no auth, no rate limit. Returns `200`:

```json
{ "ok": true, "version": "1.0.0" }
```

`version` comes from the repo `VERSION` file (see `site/lib/version.ts`).
If `/health` doesn't answer, the server is down or unreachable — nothing
fancier to check first.

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
- **Backup freshness:** currently one-click DB backup at `/backup`
  (admin). Automated per-customer backups are #730 part 2 — once they
  land, alert if the newest backup per customer is older than 24h.
- **TLS/cert:** Cloudflare terminates TLS. If browsers report cert
  errors but `/health` is fine, it's the Cloudflare edge, not us.

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
