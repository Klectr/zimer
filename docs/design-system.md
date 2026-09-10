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
- **Icons:** inline SVG via `icon(name)` in `site/server.ts` — M3 outlined
  24px style (`stroke="currentColor"`, round caps/joins), no icon font or CDN.
  Sizing: 20px leading in tabs, 18px in buttons, 24px in the extended FAB,
  24px in icon buttons. Icons are visual cues alongside labels, never the only
  affordance. Destructive actions (delete) use the system `delete` icon in a
  standard icon button with a hover tooltip — never emoji.
- **Text-field affixes:** M3 text-field anatomy includes prefix/suffix in
  `on-surface-variant`. Use `.has-prefix` / `.has-suffix` with `.affix.prefix`
  / `.affix.suffix` spans (e.g. `$` … `/hr`) instead of cramming units into the
  floating label. `.compact` gives a 40dp field for dense list rows.
- **Manage forms:** `.manage-form` stacks the name field full-width over a
  control row (`.manage-form-row`) whose primary action is end-aligned. The
  form's submit is a **filled** button (highest emphasis = the form's primary
  action); secondary row actions stay text buttons.
- **Color control:** `.md-color-control` — M3 has no color picker, so ours is a
  tonal container with a palette icon, "Color" label, and a circular swatch.
- **Selects:** native `<select>` keeps its OS-drawn arrow button, which ignores
  our radius — so selects use `appearance: none` with a custom chevron
  (M3 exposed-dropdown pattern), keeping the same 12px tonal container as
  every other field.
- **Info callout:** `.form-info` — tonal container (`surface-container-highest`)
  with a leading icon for form-level helper text. Lives at the top of the form
  it describes, never floating between fields. No borders.
- **Form actions:** submit rows use `.row.end` — buttons are end-aligned
  (right in LTR), per the M3 dialog/action convention. Confirming action sits
  farthest right when there are several.

## Patterns

- **Page layout (M3).** Content pages (dashboard, calendar, invoices list) are
  full-bleed and start-aligned. Focused task pages (forms like New invoice) use
  a centered narrow body column — `.page-narrow`, 720px max — with content
  inside start-aligned. Rationale, from the M3 spec site: layouts are built
  from regions, and the body region is a centered container with flexible
  margins/widths at larger breakpoints
  ([canonical layouts](http://m3.material.io/foundations/layout/canonical-layouts),
  [large-screen guidance](https://m3.material.io/blog/5-steps-large-screen-apps)).
  Centering the column keeps a focused task visually contained; it does not
  center the form's contents.
- **No hard borders.** If you're reaching for `border:`, use a surface tone
  step or whitespace instead.
- **No horizontal scrolling.** Tables and grids must fit; the calendar page is
  capped at 1360px wide as precedent.
- **Calendar entries:** full-width single lane per day, tracked time only.
  Overlapping entries keep full width and stack with a soft upward layered
  shadow so the topmost stays clickable.
- **Calendar header (M3 date-picker pattern).** Headline leading
  ("This week · total"); navigation icon buttons grouped at the trailing end
  (chevrons with "Previous/Next week" tooltips). A "Today" text button appears
  only when viewing a non-current week. Today is marked with a filled primary
  circle on the day number and a 10% primary tint on its lane.
- **Charts:** hand-rolled SVG (no libraries). Distinguish series by tone/shade
  first, hue second.
- **HTMX:** server-rendered partials swapped in place (`hx-post`/`hx-get`
  + `hx-target`/`hx-swap`). No client-side rendering frameworks.
- **Empty states:** every list gets one — plain, tonal, no illustration
  libraries.
