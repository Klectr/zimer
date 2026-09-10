# Design system — timekeep

Material 3, dark theme. Everything below is grounded in
`site/static/style.css` — extend the tokens there, don't invent new ones.

## Color

| Token | Value | Use |
|---|---|---|
| `--md-sys-color-primary` | `#f2c14e` | Primary actions, active states **only** |
| `--md-sys-color-on-primary` | `#3a2a00` | Text/icons on primary |
| `--md-sys-color-primary-container` | `#6b4e12` | Tonal primary surfaces |
| `--md-sys-color-on-primary-container` | `#ffe9bd` | Text on primary container |
| `--md-sys-color-surface` | `#131318` | Page background |
| `--md-sys-color-on-surface` | `#e5e1e9` | Primary text |
| `--md-sys-color-on-surface-variant` | `#cac4cf` | Secondary text |
| `--md-sys-color-surface-container-lowest` | `#0d0d12` | Sunken areas |
| `--md-sys-color-surface-container-low` | `#1a1a20` | Cards (resting) |
| `--md-sys-color-surface-container` | `#1e1e24` | Cards (raised) |
| `--md-sys-color-surface-container-high` | `#28282f` | Hover / menus |
| `--md-sys-color-surface-container-highest` | `#33333b` | Dialogs, topmost |
| `--md-sys-color-secondary-container` | `#454654` | Tonal chips/badges |
| `--md-sys-color-error` / `-container` | `#ffb4ab` / `#93000a` | Destructive |

**Elevation without borders:** go up the surface-container scale instead of
drawing outlines. `--md-sys-color-outline` exists for M3 completeness — prefer
not to need it.

## Typography

Font stack: `"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

Classes: `.md-headline-small`, `.md-title-large`, `.md-title-medium`,
`.md-title-small`, `.md-body-large`, `.md-body-medium`, `.md-label-large`,
`.md-label-medium`.

## Shape

`--md-sys-shape-corner-extra-small: 4px`, `-small: 8px`, `-medium: 12px`,
`-large: 16px`, `-extra-large: 28px`, `-full: 999px` (pills/chips).

## State layers

Hover `0.08`, focus `0.1`, pressed `0.1` — overlay on-primary/on-surface, never
a border-color change.

## Components

All components live as classes in `style.css`; reuse them, don't restyle
per-page:

- **Buttons:** `.md-filled-button` (primary actions), `.md-tonal-button`,
  `.md-outlined-button` (use sparingly — borders are a last resort),
  `.md-text-button` (navigation, cancel), `.md-icon-button`, `.md-extended-fab`
  (timer start/stop).
- **Navigation:** `.md-tabs` + `.md-tab`; `.md-top-app-bar`.
- **Data:** `.md-card`, `.md-list` + `.md-list-item`
  (headline/supporting/trailing slots), `.md-table`, `.md-chip`.
- **Inputs:** `.md-text-field` — tonal and borderless. Never draw input boxes
  with outlines.
- **Status pills:** invoice `draft / sent / paid` render as tonal pills
  (see `statusPill` in `site/server.ts`).
- **Info callout:** `.form-info` — tonal container (`surface-container-highest`)
  with a leading icon for form-level helper text. Lives at the top of the form
  it describes, never floating between fields. No borders.
- **Form actions:** submit rows use `.row.end` — buttons are end-aligned
  (right in LTR), per the M3 dialog/action convention. Confirming action sits
  farthest right when there are several.

## Patterns

- **No hard borders.** If you're reaching for `border:`, use a surface tone
  step or whitespace instead.
- **No horizontal scrolling.** Tables and grids must fit; the calendar page is
  capped at 1360px wide as precedent.
- **Calendar entries:** full-width single lane per day, tracked time only.
  Overlapping entries keep full width and stack with a soft upward layered
  shadow so the topmost stays clickable.
- **Charts:** hand-rolled SVG (no libraries). Distinguish series by tone/shade
  first, hue second.
- **HTMX:** server-rendered partials swapped in place (`hx-post`/`hx-get`
  + `hx-target`/`hx-swap`). No client-side rendering frameworks.
- **Empty states:** every list gets one — plain, tonal, no illustration
  libraries.
