# AGENTS.md — timekeep

> Read this whole file before doing anything in this repo. It's short on purpose:
> everything an agent must know at all times is up front; deeper detail is linked
> at the bottom.

## What this is

Self-hosted Toggl replacement. One deploy: `bun site/server.ts` + one SQLite
file (WAL mode). Stack: **Bun** + **HTMX** + **bun:sqlite**, vanilla-JS
Manifest V3 browser extension. No frontend build step, anywhere.

## Hard rules — never violate

- **Bun only.** Never npm, npx, yarn, or pnpm.
- **No Docker. No PHP/Laravel.**
- **Zero-dependency ethos:** hand-rolled PDF writer (`site/pdf.ts`), hand-rolled
  SVG charts. No chart libraries, no PDF libraries, no Stripe SDK (plain `fetch`
  to `api.stripe.com`).
- HTMX loads from CDN (`https://unpkg.com/htmx.org@2.0.4`). Do not bundle it
  locally without asking.
- Secrets live in env vars (`TIMEKEEP_TOKEN`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`). Never in the DB, never in logs, never in chat.

## Design philosophy — applies to ALL UI work

This is the most violated thing by new agents, so it's up front, not linked:

- **Google Material 3, dark theme.** Follow the M3 spec, don't improvise.
- **No hard borders.** Separate content with whitespace, color, shade, and tone —
  never `1px solid` dividers.
- **Accent:** gold `#f2c14e` (primary), `#3a2a00` on-primary. Use sparingly:
  primary actions and active states only.
- **Tonal, borderless fields.** Soft shadows, M3 shape scale (4/8/12/16/28px).
- **No horizontal scrolling, ever.** Layouts must fit their container.
- **Calendar conventions:** single-lane days showing tracked time only;
  entries are full-width, never side-by-side; overlaps get a soft upward
  layered shadow.

## Product decisions — don't relitigate

- **No email sending.** Invoices download as PDF; the user sends them manually.
- Invoice lifecycle: `draft → sent → paid`. Line items snapshot at creation —
  sent invoices never change.
- Auth: Bearer `TIMEKEEP_TOKEN` for the API/extension; HttpOnly cookie sessions
  for pages.

## Working in this repo

- Canonical remote: `github.com/tristonarmstrong/timekeep`, branch `main`.
- The local working copy may be a **non-git directory** — that's fine, don't
  `git init` it.
- Some machines have no git credentials: push via the GitHub git-database API
  (blobs → tree → commit → update ref). See `docs/workflow.md`. Never ask the
  user to paste tokens.
- Work is tracked as **thin vertical slices under milestones**. Check open
  milestones/issues before starting; each slice is DB → API → UI with
  acceptance criteria and non-goals.

## Detail docs

- [docs/design-system.md](docs/design-system.md) — full M3 tokens, components,
  and UI patterns
- [docs/workflow.md](docs/workflow.md) — pushing without git auth, local dev,
  issue/slice conventions
- [PLAN.md](PLAN.md) — architecture, data model, API contract
