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

M3 Expressive is the target spec generation — baseline M3 variants are legacy;
where a component exists in both, follow the expressive token.

## State layers

Hover `0.08`, focus `0.1`, pressed `0.1` — overlay on-primary/on-surface, never
a border-color change.

## Components

All components live as classes in `style.css`; reuse them, don't restyle
per-page:

- **Buttons:** `.md-filled-button` (primary actions — including the timer
  card's Start/Stop), `.md-tonal-button`,
  `.md-outlined-button` (use sparingly — borders are a last resort),
  `.md-text-button` (navigation, cancel), `.md-icon-button`.
- **Navigation:** `.md-tabs` + `.md-tab`; `.md-top-app-bar`.
- **Data:** `.md-card`, `.md-list` + `.md-list-item`
  (headline/supporting/trailing slots), `.md-table`, `.md-chip`.
- **Inputs:** `.md-text-field` — tonal and borderless. Never draw input boxes
  with outlines.
- **Status pills:** invoice `draft / sent / paid` render as tonal pills
  (see `statusPill` in `site/server.ts`).
- **Status rows:** `.status-row` — M3 two-line list-item anatomy for
  icon + status text (settings License and Updates sections): leading icon,
  headline (body-large), supporting text (body-medium,
  on-surface-variant). The icon top-aligns with the first line; wrapped
  supporting text keeps its hanging indent. The license row adds
  `.status-row-licensed` for the gold check — licensed is an active state,
  which is where the design doc allows gold. Update statuses each get their
  own leading icon (#404): up-to-date → check (on-surface-variant); an
  available update → download in primary (`.status-row-primary`) — it prompts
  a primary action (re-run the installer / buy a new major); unreachable →
  the `alert` warning-triangle in error (`.status-row-error`); no-releases,
  dev, and the idle pre-check state → info (on-surface-variant), neutral and
  informational.
- **Update-check progress:** while the feed fetch is in flight, htmx adds
  `.htmx-request` to the "Check for updates" button and the squiggly logo
  swaps into the refresh icon's 18px box (`#check-updates-btn .btn-spinner`);
  the clock hands spin (`tk-logo-spin`, `transform-origin` at the clock
  center) — never the whole mark. `prefers-reduced-motion` shows the static
  logo. The button self-disables via `hx-disabled-elt` for the request
  duration. Disabled buttons render at 45% opacity, default cursor.
- **Icons:** inline SVG via `icon(name)` in `site/server.ts` — M3 outlined
  24px style (`stroke="currentColor"`, round caps/joins), no icon font or CDN.
  Sizing: 20px leading in tabs, 18px in buttons,
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
- **Dialogs (#355).** 600px+ keeps the centered basic dialog (scrim, 28dp
  corners, scale/fade motion). Below 600px the calendar entry and settings
  dialogs go full-screen: full bleed, no corner radius, full viewport height,
  with a title/close app-bar row pinned at the top. Dismissal (Escape, scrim
  tap, close), focus, and motion are unchanged.
- **App-bar actions — locked spec (#654).** Triston's call: the hamburger
  account menu (#155, locked #395) hid Settings, Export entries CSV, Download
  backup, and Log out two taps deep, so the four are now icon buttons on the
  right side of the top app bar (every page), in an `.app-bar-actions` row
  (inline-flex, 4px gap). Text labels became `data-tip` tooltips; the buttons
  are the shared 48dp `.md-icon-button`. Export and Backup got distinct icons
  (spreadsheet grid, database) instead of sharing the download glyph.
- **Page layout (M3).** Content pages (dashboard, calendar, invoices list) are
  full-bleed and start-aligned. Focused task pages (forms like New invoice) use
  a centered narrow body column — `.page-narrow`, 720px max — with content
  inside start-aligned. Rationale, from the M3 spec site: layouts are built
  from regions, and the body region is a centered container with flexible
  margins/widths at larger breakpoints
  ([canonical layouts](http://m3.material.io/foundations/layout/canonical-layouts),
  [large-screen guidance](https://m3.material.io/blog/5-steps-large-screen-apps)).
  Centering the column keeps a focused task visually contained; it does not
  center the form's contents. **Window size classes (M3):** compact <600px,
  medium 600–839px, expanded 840–1199px, large 1200–1599px, extra-large 1600px+.
  All width media queries use these breakpoints — ad-hoc thresholds (560px,
  760px, 900px) are only allowed for genuinely content-driven switches, each
  documented with a comment. Body leading/trailing margins: 16px compact, 24px
  medium+ (`--layout-body-margin`). Inter-pane spacer: 24px everywhere
  (`--layout-pane-gap`).
- **Supporting-pane layout (M3, timer page).** The timer page uses the M3
  supporting-pane canonical layout with responsive switching. Below 840px it
  is a single stacked column (timer card → today's entries → revenue); at
  840px and up the focus pane (timer card + today's entries, fluid) sits
  beside a trailing fixed supporting pane (revenue summary) with a 24px gap,
  and each pane owns its own scroll. The pane is 360px at expanded
  (840–1199px) and 412px at large/XL (1200px+) — `--layout-supporting-pane`.
  Revenue is the supporting pane because it
  is contextual info derived from tracked time, per the spec's supporting-pane
  test. The stat cards reflow inside the narrow pane via container queries
  (`@container (max-width: 480px)`), not viewport queries. The calendar page
  mirrors the same canonical layout (week summary aside, same breakpoint,
  gap, and pane widths).
- **Hierarchical lists (M3).** The spec defines no nested/indented list
  pattern and no list subheaders — a list's one hierarchy mechanism is
  folder-like expand/collapse ("List items containing other list items can
  expand and collapse in a folder-like manner, to reveal or hide content").
  Grouping is done with segmented gaps and filled items, not nested chrome;
  cards are for single-topic content ("Don't force content into cards when
  spacing, headlines, or dividers would create a simpler visual hierarchy").
  On Manage, clients are segments of one list: a client row (leading expand
  chevron, color dot + name, inline rate, delete) reveals its project rows
  in place. Repetitive child rows are separated by whitespace alone, which
  the spec sanctions; full-width dividers are reserved for separating
  distinct groups, and the spec warns that too many divider lines read as
  clutter. "No client" is a section label over its own segment, not a fake
  parent row. Expanded/collapsed state persists in localStorage and is
  reapplied after HTMX swaps.
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
- **Billable definition.** On the calendar, an entry is billable when it has
  a project (hence a client); entries without a project are non-billable.
  Day headers and the week header show the billable portion beneath each
  total (e.g. "6h 30m" then "5h billable").
- **Primary navigation (M3, #354).** Compact (<600px): bottom navigation bar
  with the four destinations, fixed to the bottom edge. Medium and wider
  (600px+): collapsed leading navigation rail, outside all panes on the
  leading edge, below the app bar. The switch is the 600px breakpoint — rail
  and bar never show together. The rail is 72px wide — a documented deviation
  from the M3 80dp default (#397): the 56px active-indicator pill keeps 8px
  clearance and the one-word labels (longest: "Calendar") stay legible.
  72px is the floor with labels — kept Sep 21 2026 (#400); icon-only 64px
  was the only way to go narrower and was rejected to preserve wayfinding.
  Layout chrome stays px by design (maps 1:1 to M3 dp; browser zoom covers
  enlargement) — the type scale's px→rem conversion is tracked in #399.
  The active destination gets the M3
  active-indicator pill (`secondary-container`) behind its icon; labels are
  one word and never truncated ("Clients"). The top app bar keeps the brand
  mark leading and the account menu trailing only — it never carries primary
  navigation.
- **Secondary actions placement.** Nothing lives below a growing list —
  lists can be infinitely long, so trailing sections get buried and add
  clutter. Infrequent/maintenance actions (backup, export) go in the global
  top-app-bar account menu, hidden behind one user action instead of
  competing with content. Page-level primary actions may sit above the list
  (precedent: recurring schedules above the invoices list, #142).
- **Fixed viewport, regions own the scroll.** App pages (timer, calendar,
  invoices list, manage) opt in via `layout(..., fixed=true)`: `body.app-fixed`
  is a 100dvh flex column, the page never scrolls, and exactly one region owns
  the vertical scroll (`.scroll-region`; the calendar's week grid instead).
  The navigation rail sits in the chrome row between the app bar and the
  content column — outside all scroll regions. Document-like pages (invoice
  detail, new/edit forms) keep page scroll — the
  invoice detail must print.
- **Charts:** hand-rolled SVG (no libraries). Distinguish series by tone/shade
  first, hue second.
- **HTMX:** server-rendered partials swapped in place (`hx-post`/`hx-get`
  + `hx-target`/`hx-swap`). No client-side rendering frameworks.
- **Empty states:** every list gets one — plain, tonal, no illustration
  libraries.
