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

- **LobeHub design system, Zimer colors, dark theme.** The canonical spec is
  `DESIGN.md` at the repo root — follow it, don't improvise. (Material 3 and
  the old rules in `docs/design-system.md` are superseded.)
- **Borders first.** Translucent 1px borders are the primary separator;
  hierarchy comes from tonal surfaces (lighter as they rise) and borders.
  Shadows only for floating layers, per the DESIGN.md tiers.
- **Accent:** pumpkin `#fb923c` (primary). Use sparingly: the single most
  important action per view, the running-timer state, and links.
- **Scales, no exceptions.** Type 12/14/16 with headings 38/30/24/20 (no
  off-scale sizes), radius 4/6/8/12, spacing on the 4px scale, control
  heights 28/36/40. Components read semantic tokens, never hard-code hex.
- **Icons, never emoji/glyphs.** Actions use the `icon(name)` system in
  `site/lib/icons.ts` (inline SVG, no icon font). Never use emoji or text
  glyphs (🗑️, ✎, ▶, ←) as action icons.
- **Text-field affixes.** Units and currency go in prefix/suffix affixes
  (`$` … `/hr`), never crammed into the label.
- **Selects are custom.** Native `<select>` keeps its OS arrow, which ignores
  our radius — always `appearance: none` + the custom chevron.
- **No horizontal scrolling, ever.** Layouts fit their container or change
  pattern (see the calendar rule in DESIGN.md).
- **Calendar conventions:** single-lane days showing tracked time only;
  entries are full-width, never side-by-side; overlaps get a soft upward
  layered shadow. The drag visualizer's interactions (drag to move, handles
  to resize, 15-minute snap) are a keeper — restyle, never remove.

## Product decisions — don't relitigate

- **No email sending.** Invoices download as PDF; the user sends them manually.
- Invoice lifecycle: `draft → sent → paid`. Line items snapshot at creation —
  sent invoices never change.
- Auth: Bearer `TIMEKEEP_TOKEN` for the API/extension; HttpOnly cookie sessions
  for pages.

## Working in this repo

- Canonical remote: `github.com/tristonarmstrong/zimer`, branch `main`.
- The local working copy may be a **non-git directory** — that's fine, don't
  `git init` it.
- Some machines have no git credentials: push via the GitHub git-database API
  (blobs → tree → commit → update ref). See `docs/workflow.md`. Never ask the
  user to paste tokens.
- Work is tracked as **thin vertical slices under milestones**. Check open
  milestones/issues before starting; each slice is DB → API → UI with
  acceptance criteria and non-goals.
- **Standing change process:** file an issue → open a PR early (`Closes #N`)
  → implement on a branch → narrate decisions as issue/PR comments →
  test → merge. No direct pushes to `main`; every issue must end with a
  complete timeline. See `docs/workflow.md`.

## Detail docs

- [DESIGN.md](DESIGN.md) — the canonical design spec (tokens, components,
  voice); [docs/design-system.md](docs/design-system.md) is the superseded
  M3 document, kept as history
- [docs/workflow.md](docs/workflow.md) — pushing without git auth, local dev,
  issue/slice conventions
- [PLAN.md](PLAN.md) — architecture, data model, API contract
