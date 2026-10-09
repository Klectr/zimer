# #949: Mobile top-bar icon buttons — investigation

## Problem

The top app bar has four icon-only action buttons. On desktop, hovering reveals
a tooltip (`data-tip`). On mobile there's no hover, so users can't tell what the
buttons do without tapping each one.

## Current state (site/views/layout.ts, `appBarActions()`)

| Icon | Action | `aria-label` / `data-tip` | Frequency |
|------|--------|---------------------------|-----------|
| gear | Open settings dialog | "Settings" | Occasional |
| table | Download entries CSV | "Export entries CSV" | Rare |
| database | Download full backup | "Download backup" | Rare |
| arrow | Log out (POST) | "Log out" | Rare |

Notes:

- All four already have `aria-label` (screen readers) and `data-tip` tooltips.
- Tooltips fire on desktop `:hover` and on mobile via a 450 ms long-press
  (`site/static/shortcut.js`, #496). The mechanism exists but is undiscoverable —
  nobody knows to long-press.
- Primary navigation (Zimer / Calendar / Zinvoices / Clients) is NOT affected:
  it already renders with text labels in the bottom nav bar on mobile (<600 px)
  and the nav rail on desktop.
- History: #654 deliberately moved these four actions OUT of a hamburger menu
  into visible icon buttons — "Triston wanted the four global actions visible
  instead of two taps deep." A drawer would partially reverse that decision.

## Proposal: labeled navigation drawer on mobile

Keep the top bar to brand mark + a single hamburger button on compact screens.
The drawer lists each action as a labeled row (icon + text), which solves
discoverability without tooltips:

- Settings
- Export entries CSV
- Download backup
- Log out

Interaction pattern (M3 navigation drawer):

- Hamburger in the app bar opens the drawer (slide from the leading edge).
- Scrim behind the drawer; tapping scrim or pressing Escape closes it.
- Focus moves into the drawer on open, returns to the hamburger on close.
- The settings dialog trigger moves from `#appbar-settings-btn` to the drawer's
  Settings row (the dialog JS keys off that id — rename or rewire).
- Log out stays a POST form, just relocated into the drawer.
- Desktop (600 px+) keeps the current icon-button row unchanged.

What stays visible on mobile: just the hamburger. Rationale: none of the four
actions is used often enough to earn a permanent slot, and four mystery icons
are worse than one labeled entry point.

## Why not smaller fixes

- **Long-press hint / coachmark:** adds UI chrome to explain other UI chrome.
- **Tiny labels under the icons:** crowds the 56 px app bar; M3 top app bars
  don't do this.
- **Do nothing (long-press already works):** true, but undiscoverable — the
  complaint stands.

## Scope estimate

Not small: new drawer markup + CSS + open/close JS (keyboard + scrim + focus),
rewiring the settings-dialog trigger id, moving the logout form, and
screenshot/test coverage for both breakpoints. Recommend implementing as its
own follow-up issue rather than in this investigation.

## Open questions for Triston

1. Drawer for all four actions, or keep one (e.g. Settings) visible?
2. Should the drawer also absorb anything else (theme picker lives in settings)?
