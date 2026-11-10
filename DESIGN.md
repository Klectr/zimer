---
version: alpha
name: Zimer (Dark)
description: Zimer's design system — dark theme. The suite mock's Chinese-style surface layer (glass cards, pill chips, 8/14/20 radius) sits on the LobeHub token model (typography, spacing, controls, motion, component and voice rules) with Zimer's colors: pumpkin primary and Zimer's semantic palette. Components must read semantic tokens, never hard-code hex. Canonical spec for all Zimer UI work; supersedes the Material 3 system previously documented in docs/design-system.md.
colors:
  colorPrimary: "#fb923c"
  colorSuccess: "#34d399"
  colorWarning: "#fbbf24"
  colorError: "#f87171"
  colorInfo: "#60a5fa"
  colorText: "#f5f5f4"
  colorTextSecondary: "#a1a1aa"
  colorTextTertiary: "#71717a"
  colorTextQuaternary: "#52525b"
  colorBgLayout: "#08090a"
  colorBgContainer: "#0d0d0f"
  colorBgContainerSecondary: "#0a0b0c"
  colorBgElevated: "#16171a"
  colorBgSpotlight: "#1e1f23"
  colorBorder: "rgba(255, 255, 255, 0.14)"
  colorBorderSecondary: "rgba(255, 255, 255, 0.08)"
  colorFill: "rgba(255, 255, 255, 0.10)"
  colorFillSecondary: "rgba(255, 255, 255, 0.06)"
  colorFillTertiary: "rgba(255, 255, 255, 0.04)"
  colorFillQuaternary: "rgba(255, 255, 255, 0.02)"
typography:
  fontFamily: Geist, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, "HarmonyOS Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif
  fontFamilyCode: "Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Code", Consolas, "HarmonyOS Sans SC", monospace
  fontSizeSM: 12
  fontSize: 14
  fontSizeLG: 16
  fontSizeXL: 20
  lineHeight: 1.5714
  lineHeightSM: 1.6667
  fontSizeHeading1: 38
  fontSizeHeading2: 30
  fontSizeHeading3: 24
  fontSizeHeading4: 20
  fontSizeHeading5: 16
  fontWeightStrong: 600
spacing: { XXS: 4, XS: 8, SM: 12, base: 16, MD: 20, LG: 24, XL: 32 }
radius: { borderRadiusXS: 4, borderRadiusSM: 6, borderRadius: 8, borderRadiusLG: 14, borderRadiusXL: 20 }
controls: { controlHeightSM: 28, controlHeight: 36, controlHeightLG: 40 }
elevation:
  boxShadowTertiary: "0 3px 1px -1px rgba(26,26,26,0.06)"
  boxShadowSecondary: "0 8px 16px -4px rgba(0,0,0,0.2)"
  boxShadow: "0 20px 20px -8px rgba(0,0,0,0.24)"
---

# Zimer

Zimer is a solo time tracker: timer to invoice in two clicks. Calm, dense where density helps, content-first. The user's work — timers, hours, invoices — stays in focus; the interface carries state and hierarchy, not decoration.

Design values (LobeHub's, adopted from Ant Design): **Natural · Meaningful · Certainty · Growth.**

- Natural — follow how people scan; the running timer is always the most prominent thing on its page.
- Meaningful — every element names its job or gets cut. Color carries meaning, not decoration.
- Certainty — same problem, same pattern, every surface including the extension popup. Explicit states, never guessed.
- Growth — start simple (two pricing options, one job), reveal depth as the user needs it.

## Colors

Consume tokens by name (`--color-text`, `--color-bg-container`, …). Never hard-code the hex above in a component.

- Text ranks with the neutral ramp: `colorText` → `colorTextSecondary` → `colorTextTertiary` → `colorTextQuaternary` (disabled). Rank information with this ramp before reaching for color.
- Surfaces get lighter as they rise in dark: `colorBgLayout` (canvas) → `colorBgContainer` → `colorBgElevated` (popovers, menus, modals) → `colorBgSpotlight` (tooltips). `colorBgContainerSecondary` gives subtle separation within a container. Don't flatten the stack.
- Borders and fills are translucent white so they layer over any surface. `colorBorderSecondary` is the everyday divider; `colorBorder` is the stronger edge.
- `colorPrimary` is pumpkin `#fb923c` — Zimer's deliberate brand exception to LobeHub's monochrome default. It is reserved for the single most important action per view, the running-timer state, and links. Don't spread it as decoration.
- No ambient glow or decorative color wash anywhere. Color carries state and hierarchy, not decoration.
- Status is a tinted chip + a word, never color alone: the functional color's derived Bg tint behind its own hue as text — Draft (neutral), Sent (info), Paid (success), Overdue (error), Running (success, with dot).
- Each functional color exposes derived ramp tokens (`--color-*-bg` tints for chips and washes, `--color-*-hover` / `--color-*-active` for solid fills, `--color-*-border`); consume the tokens instead of hand-mixing.

## Typography

Geist sets UI and prose (LobeHub's stack verbatim, Chinese fallbacks included); Geist Mono sets numbers, always tabular so totals align. Scale is 12 / 14 / 16 / 20 — there is no 13px; off-scale sizes are drift, round to the nearest step and rank with the text ramp instead. Headings 38 → 16 at weight 600, tight tracking (-0.02em to -0.045em) on large sizes only. Line height is 1.5714 for body text, 1.6667 for small text.

## Layout

Spacing follows the 4px scale (4 / 8 / 12 / 16 / 20 / 24 / 32) for gaps, padding, and margins only — radius and icon sizes are separate dimensions. Tight inside a group (8), more between groups (16), most between sections (24–32). Cards pad 16–24.

- Don't make me tap: the timer home shows running timer, today, week, and unbilled on one screen.
- Forms sit at the top of a list, never below it.
- Less-used functions hide one layer down; editing hides one layer below that (progressive disclosure).
- Every surface is designed for mobile as its own pattern when the desktop pattern doesn't fit — never a shrunken desktop popover.
- No horizontal scrolling, ever. Layouts fit their container or change pattern.
- Calendar: week grid at content widths of 1024px and up (max 4 entries per day, the rest behind a “+N more” row); agenda list below 1024px. A day header is one line — date left, total right, never wrapping. The drag visualizer keeps its interactions at grid widths: drag a block to move it, drag its top/bottom handles to resize, 15-minute snap, totals update live.
- Prefer icon buttons with tooltips (the app's own Tooltip component) over labeled buttons, except where a labeled control is kept for findability.

## Elevation & Depth

Borders first, shadows last, exactly as LobeHub: translucent 1px borders are the primary separator between content (this repeals the former no-borders rule). Hierarchy comes from tonal surfaces and borders, so most cards need no shadow — a `colorBorderSecondary` edge is enough. Lift only what genuinely floats, using the three tiers: panels `boxShadowTertiary`, popovers/menus `boxShadowSecondary`, modals `boxShadow`. Surfaces are a translucent white wash over the canvas (the suite's glass cards); hierarchy still comes from borders and tonal steps, and translucency stays in surfaces, borders, and fills.

## Motion

Motion clarifies change; it is never decoration. 100–200ms for state changes and popovers, up to ~300ms for overlays and modals, physical easing. Honor `prefers-reduced-motion` by dropping nonessential animation. No looping or attention-grabbing animation.

## Shapes

One radius family per view, the suite's scale with no exceptions: 4 (small inner details), 6 (small controls), 8 (buttons, inputs — the default), 14 (cards), 20 (auth cards, public sheets, modals). Fully round only for pills, avatars, and circular icon buttons.

## Components

Icons come only from the app's `icon()` system (`site/lib/icons.ts`, inline SVG). Never use emoji or text glyphs as action icons.
Use Zimer's existing shared components and server templates; don't hand-roll a new one when an existing one does the job. The UI lab page (`/ui-lab`, dev-only) renders every component in every state — check there before inventing a variant. Abstraction only at 3+ uses; two uses stay inline.

- One primary (pumpkin fill) button per view. Default buttons are surface fill + border. Danger is error-tinted; the destructive confirm is solid error.
- Control heights: 28 / 36 / 40. Default 36.
- Disabled uses `colorTextQuaternary` + not-allowed cursor. Every interactive element shows a visible `:focus-visible` ring.
- HTMX states are design states: the `htmx-request` class drives loading buttons; toasts arrive as out-of-band swaps and confirm outcomes by name.

## Voice & Content

Canonical terms, never synonym drift: **Zimer** (a timer), **Zinvoice** (an invoice), Client, Project, Entry. In user-facing copy "timer" is written Zimer and "invoice" is written Zinvoice; code identifiers and routes stay plain.

- Buttons are verb + noun (`Send Zinvoice`, `Add client`), never bare Confirm / OK / Submit.
- An action keeps the same name through its flow: Send produces "Zinvoice #1041 sent to Northwind Legal."
- In-progress states use a present participle with an ellipsis (`Saving…`, `Sending…`).
- Plain words, sentence case, no hype, no filler. 80% information, 20% warmth; warmth is at most one sentence and always followed by the next step.
- Errors explain what happened and how to fix it, in place, without apologizing.
- An empty state is an invitation to act, with the action on it.

## Do's and Don'ts

- Do read semantic tokens. Don't hard-code hex from this file.
- Do design all four data states — empty, loading, error, success. Don't ship only the happy path.
- Do signal status with a tinted icon chip + word in toasts and alerts. **Don't use a thick colored side border (left accent bar) on cards, toasts, or alerts — ever.**
- Do keep `colorBg*` surfaces and `colorText*` / `colorFill*` scales distinct. Don't swap a surface token for a text token.
- Do hold WCAG AA contrast (4.5:1 body text) and a visible focus ring.
- Don't add code comments to carry design intent — this file carries it; code carries itself.
