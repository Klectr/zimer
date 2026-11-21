import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../static/style.css"), "utf8");

const INLINE_SET_VARS = ["--cal-hour", "--dot", "--entry"];

describe("legacy snapshot compat", () => {
  test("the sheet table rules keep their .md-table aliases for frozen snapshots (#301)", () => {
    expect(css).toContain(".invoice-sheet .md-table");
    expect(css).toContain(".template-modern .md-table");
  });

  /* #1133: desktop visuals are forked — .md-table (frozen) keeps the legacy
     card-row declarations; .inv-table (live) carries hairline rows. */
  test("the frozen .md-table keeps its legacy row fill; the live .inv-table is hairline-only", () => {
    const legacy = css.match(/\.md-table tbody tr \{[^}]*\}/);
    expect(legacy).not.toBeNull();
    expect(legacy![0]).toContain("background: var(--color-bg-container)");
    const live = css.match(/\.inv-table tbody tr \{[^}]*\}/);
    expect(live).not.toBeNull();
    expect(live![0]).toContain("border-bottom: 1px solid var(--color-border-secondary)");
    expect(live![0]).not.toContain("background");
    const liveHead = css.match(/\.inv-table thead th \{[^}]*\}/);
    expect(liveHead).not.toBeNull();
    expect(liveHead![0]).not.toContain("text-transform");
    const modernLive = css.match(/\.template-modern \.inv-table thead th \{[^}]*\}/);
    expect(modernLive).not.toBeNull();
    expect(modernLive![0]).toContain("background: transparent");
    expect(modernLive![0]).toContain("text-transform: none");
  });
});

describe("native picker indicators (#1220)", () => {
  test("datalist, date, time and datetime-local indicators are hidden", () => {
    expect(css).toContain('input[list]::-webkit-calendar-picker-indicator');
    expect(css).toContain('input[type="date"]::-webkit-calendar-picker-indicator');
    expect(css).toContain('input[type="time"]::-webkit-calendar-picker-indicator');
    expect(css).toContain('input[type="datetime-local"]::-webkit-calendar-picker-indicator');
    const rule = css.match(/input\[list\]::-webkit-calendar-picker-indicator,[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("display: none");
  });
});

describe("on-filled text token (#1095)", () => {
  test("the token is defined and the solid-error button uses it, not a surface token", () => {
    expect(css).toContain("--color-text-on-filled: #08090a;");
    const rule = css.match(/\.ui-btn-primary\.ui-btn-danger \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("color: var(--color-text-on-filled)");
    expect(css).not.toMatch(/(?:color|fill):\s*var\(--color-bg-/);
  });
});

describe("demo banner (#1218)", () => {
  test("the banner sits on a neutral surface — no primary wash or border", () => {
    const rule = css.match(/\.demo-banner \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("background: var(--color-fill-tertiary)");
    expect(rule![0]).toContain("border: 1px solid var(--color-border-secondary)");
    expect(rule![0]).not.toContain("primary");
    const icon = css.match(/\.demo-banner > svg \{[^}]*\}/);
    expect(icon).not.toBeNull();
    expect(icon![0]).toContain("color: var(--color-text-secondary)");
    expect(icon![0]).not.toContain("var(--color-primary)");
  });
});

describe("today column and card (#1271)", () => {
  test("no is-today rule paints a primary wash or border — today is marked by the bold header, the dot and the now-line", () => {
    const todayRules = [...css.matchAll(/\.is-today[^{]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(todayRules.length).toBeGreaterThan(0);
    for (const rule of todayRules) {
      expect(rule).not.toContain("background");
      expect(rule).not.toContain("border");
      expect(rule).not.toContain("--color-primary");
    }
    const vizName = css.match(/\.ui-viz-day-head\.is-today \.ui-viz-day-name \{[^}]*\}/);
    expect(vizName).not.toBeNull();
    expect(vizName![0]).toContain("font-weight: var(--font-weight-strong)");
    const dayName = css.match(/\.ui-day\.is-today \.ui-day-name \{[^}]*\}/);
    expect(dayName).not.toBeNull();
    expect(dayName![0]).toContain("font-weight: var(--font-weight-strong)");
  });
});

describe("viz day header gutter (#1219)", () => {
  test("the header inner carries the column body's inset, so a day's total is separated from the next day's label and aligns with the blocks below", () => {
    const inner = css.match(/\.ui-viz-day-inner \{[^}]*\}/);
    expect(inner).not.toBeNull();
    expect(inner![0]).toContain("padding-inline: var(--spacing-xxs)");
    expect(inner![0]).toContain("box-sizing: border-box");
  });
});

describe("viz hour labels never clip (#1302)", () => {
  test("the viz carries half a label height of block padding, so the first and last hour labels clear the scroll edges", () => {
    const viz = css.match(/\.ui-viz \{[^}]*\}/);
    expect(viz).not.toBeNull();
    expect(viz![0]).toContain(
      "padding-block: calc(var(--font-size-sm) * var(--line-height) / 2)",
    );
  });

  test("the hour gutter fits the widest label (5 code-font glyphs at 12px plus the right offset)", () => {
    const viz = css.match(/\.ui-viz \{[^}]*\}/);
    expect(viz).not.toBeNull();
    expect(viz![0]).toContain("grid-template-columns: 52px repeat(7, 1fr)");
    const hour = css.match(/\.ui-viz-hour \{[^}]*\}/);
    expect(hour).not.toBeNull();
    expect(hour![0]).toContain("right: var(--spacing-xs)");
    expect(hour![0]).toContain("white-space: nowrap");
  });
});

describe("viz block title wrap (#1219)", () => {
  test("tall blocks wrap the title to two lines; the base title stays one-line ellipsis", () => {
    const tall = css.match(/\.ui-viz-block\.is-tall \.ui-viz-block-title \{[^}]*\}/);
    expect(tall).not.toBeNull();
    expect(tall![0]).toContain("-webkit-line-clamp: 2");
    expect(tall![0]).toContain("white-space: normal");
    const base = css.match(/\.ui-viz-block-title \{[^}]*\}/);
    expect(base).not.toBeNull();
    expect(base![0]).toContain("white-space: nowrap");
  });
});

describe("public invoice total (#1277)", () => {
  test("the public sheet total uses the text color, not primary; the app summary keeps primary", () => {
    const pub = css.match(/\.ui-public \.ui-summary-total \.num \{[^}]*\}/);
    expect(pub).not.toBeNull();
    expect(pub![0]).toContain("color: var(--color-text)");
    expect(pub![0]).not.toContain("primary");
    const shared = css.match(/\.ui-summary-total \.num \{[^}]*\}/);
    expect(shared).not.toBeNull();
    expect(shared![0]).toContain("color: var(--color-primary)");
    const print = css.slice(css.indexOf("@media print"));
    const printPub = print.match(/\.ui-public \.ui-summary-total \.num \{[^}]*\}/);
    expect(printPub).not.toBeNull();
    expect(printPub![0]).toContain("color: #111");
  });
});

describe("style.css token references", () => {
  test("every var() reference resolves to a definition (or an inline-set legacy var)", () => {
    const defs = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const refs = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    const unresolved = [...refs].filter((r) => !defs.has(r) && !INLINE_SET_VARS.includes(r));
    expect(unresolved).toEqual([]);
  });
});

describe("settings pref rows", () => {
  test("pref row wraps so a wide control stacks instead of overflowing (#1216)", () => {
    const rule = css.match(/\.settings-pref-row \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("flex-wrap: wrap");
  });
});

const RULES = [
  ".ui-btn {",
  ".ui-btn-primary {",
  ".ui-btn-ghost {",
  ".ui-btn-danger {",
  ".ui-btn-sm {",
  ".ui-btn-lg {",
  ".ui-chip {",
  ".ui-chip-draft {",
  ".ui-chip-sent {",
  ".ui-chip-paid {",
  ".ui-field {",
  ".ui-field-label {",
  ".ui-input {",
  ".ui-select {",
  ".ui-card {",
  ".ui-card.tracking {",
  ".ui-icon-btn {",
  ".ui-icon-btn-danger {",
  ".ui-hero {",
  ".ui-hero-title {",
  ".ui-hero-sub {",
  ".ui-hero-actions {",
  ".ui-hero-note {",
  ".ui-hero-product {",
  ".ui-hero-mascot {",
  ".ui-hero-shot {",
  ".ui-feature-icon {",
  ".ui-feature-body {",
  ".ui-plan {",
  ".ui-landing-body {",
  ".ui-landing-top {",
  ".ui-landing-hero {",
  ".ui-landing-h1 {",
  ".ui-landing-window {",
  ".ui-landing-section {",
  ".ui-landing-title {",
  ".ui-landing-sub {",
  ".ui-landing-cards {",
  ".ui-landing-card {",
  ".ui-landing-fig {",
  ".ui-landing-join {",
  ".ui-landing-winbar {",
  ".ui-landing-side {",
  ".ui-landing-nav {",
  ".ui-landing-week {",
  ".ui-landing-day {",
  ".ui-landing-entry {",
  ".ui-landing-miniweek {",
  ".ui-landing-term {",
  ".ui-landing-arrive {",
  ".ui-landing-foot {",
  ".ui-logo {",
  ".ui-logo-mark {",
  ".ui-side {",
  ".ui-navitem {",
  ".ui-side-foot {",
  ".ui-app-head {",
  ".ui-app-title {",
  ".ui-app-sub {",
  ".ui-app-actions {",
  ".ui-tabs {",
  ".ui-tab {",
  ".ui-running {",
  ".ui-running-dot {",
  ".ui-running-time {",
  ".ui-stat-label {",
  ".ui-stat-strip {",
  ".ui-stat-cell {",
  ".ui-stat-cell-head {",
  ".ui-stat-cell-value {",
  ".ui-stat-cell-note {",
  ".ui-stat-meter {",
  ".ui-stat-link {",
  ".ui-stat-value {",
  ".ui-stat-sub {",
  ".ui-progress {",
  ".ui-progress-fill {",
  ".ui-steps {",
  ".ui-step {",
  ".ui-step-bar {",
  ".ui-step-label {",
  ".ui-list {",
  ".ui-row {",
  ".ui-row.selected {",
  ".ui-row-lead-dot {",
  ".ui-row-lead-icon {",
  ".ui-row-chevron {",
  ".ui-btn[data-tip]::before,",
  ".ui-color-control {",
  ".ui-form-row {",
  ".ui-add-project-form {",
  ".ui-row-actions {",
  ".ui-row-dot {",
  ".ui-page-title {",
  ".ui-timer-form {",
  ".ui-repeat-form {",
  ".ui-note {",
  ".ui-block-title {",
  ".ui-target {",
  ".ui-target-label {",
  ".ui-inv-mark {",
  ".ui-rev-cards {",
  ".ui-rev-chart {",
  ".ui-rev-legend {",
  ".ui-attn-chip {",
  ".ui-row-main {",
  ".ui-row-title {",
  ".ui-row-meta {",
  ".ui-row-side {",
  ".ui-row-amount {",
  ".ui-table {",
  ".ui-table .num {",
  ".ui-chip-overdue {",
  ".ui-week {",
  ".ui-week-grid {",
  ".ui-week-agenda {",
  ".ui-day {",
  ".ui-day-head {",
  ".ui-day-name {",
  ".ui-day-dot {",
  ".ui-day-total {",
  ".ui-day-entries {",
  ".ui-week-entry {",
  ".ui-day-more {",
  ".ui-agenda-day {",
  ".ui-viz {",
  ".ui-viz-heads {",
  ".ui-viz-day-head {",
  ".ui-viz-day-inner {",
  ".ui-viz-day-name {",
  ".ui-viz-day-total {",
  ".ui-viz-hours {",
  ".ui-viz-hour {",
  ".ui-viz-col {",
  ".ui-viz-block {",
  ".ui-viz-block-title {",
  ".ui-viz-block-meta {",
  ".ui-week-entry-title {",
  ".ui-viz-handle {",
  ".ui-viz-grip {",
  ".ui-viz-now {",
  ".ui-scrim {",
  ".ui-dialog {",
  ".ui-dialog-head {",
  ".ui-dialog-title {",
  ".ui-dialog-body {",
  ".ui-dialog-actions {",
  ".ui-toast {",
  ".ui-toast-chip {",
  ".ui-toast-title {",
  ".ui-toast-body {",
  ".ui-menu {",
  ".ui-menu-item {",
  ".ui-empty {",
  ".ui-empty-icon {",
  ".ui-empty-title {",
  ".ui-empty-body {",
  ".ui-empty-action {",
];

describe("ui component CSS", () => {
  test("every class the site/ui components emit has a rule in style.css", () => {
    for (const rule of RULES) {
      expect(css).toContain(rule);
    }
  });
});

describe("invoice list compact rows (#1210)", () => {
  test("below 640px the list rows stack instead of scrolling sideways", () => {
    const block = css.match(/@media screen and \(max-width: 640px\) \{[^]*?\.inv-table-card[^]*?\n\}/);
    expect(block).not.toBeNull();
    const b = block![0];
    expect(b).toContain(".inv-table-card .table-wrap");
    expect(b).toContain("overflow-x: visible");
    expect(b).toContain(".inv-table-card tbody tr");
    expect(b).toContain("display: flex");
    expect(b).toContain("flex-wrap: wrap");
    const colOpt = b.match(/\.inv-table-card td\.col-opt \{[^}]*\}/);
    expect(colOpt).not.toBeNull();
    expect(colOpt![0]).toContain("display: block");
    expect(colOpt![0]).toContain("order: 5");
    expect(b).toContain(".inv-table-card thead");
    expect(b).toContain("clip-path: inset(50%)");
    expect(b).toMatch(/td\.num \{ order: 2;/);
    expect(b).toMatch(/td:nth-child\(5\) \{ order: 6;/);
  });

  test("invoice numbers never wrap", () => {
    const rule = css.match(/\.inv-num-link \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("white-space: nowrap");
  });
});

describe("invoice stat row on mobile (#1222)", () => {
  test("below 640px the stats are compact rows, not full-height cards", () => {
    const block = css.match(/@media \(max-width: 639px\) \{\n  \.ui-stat-row \{[^]*?\n\}/);
    expect(block).not.toBeNull();
    const b = block![0];
    const row = b.match(/\.ui-stat-row \{[^}]*\}/);
    expect(row).not.toBeNull();
    expect(row![0]).toContain("grid-template-columns: 1fr");
    expect(row![0]).toContain("gap: var(--spacing-sm)");
    const card = b.match(/\.ui-stat-row \.ui-card \{[^}]*\}/);
    expect(card).not.toBeNull();
    expect(card![0]).toContain("padding: var(--spacing-sm) var(--spacing)");
    const inner = b.match(/\.ui-stat-row \.ui-card > div \{[^}]*\}/);
    expect(inner).not.toBeNull();
    expect(inner![0]).toContain("display: flex");
    expect(inner![0]).toContain("flex-wrap: wrap");
    expect(inner![0]).toContain("align-items: baseline");
    const value = b.match(/\.ui-stat-row \.ui-stat-value \{[^}]*\}/);
    expect(value).not.toBeNull();
    expect(value![0]).toContain("font-size: var(--font-size-xl)");
    const sub = b.match(/\.ui-stat-row \.ui-stat-sub \{[^}]*\}/);
    expect(sub).not.toBeNull();
    expect(sub![0]).toContain("margin-left: auto");
    expect(sub![0]).toContain("min-width: 0");
  });
});

describe("invoice search alignment (#1257)", () => {
  test("the filter row centers the chips and the search input on the cross axis", () => {
    const rule = css.match(/\.inv-filter-row \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("align-items: center");
  });

  test("affix icons render at 16px, not the 24px svg default", () => {
    const rule = css.match(/\.ui-affix svg \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("width: 16px");
    expect(rule![0]).toContain("height: 16px");
  });

  test("below 640px the search takes the full row under the chips", () => {
    const block = css.match(/@media screen and \(max-width: 640px\) \{\n  \.inv-search \{[^]*?\n\}/);
    expect(block).not.toBeNull();
    const b = block![0];
    const form = b.match(/\.inv-search \{[^}]*\}/);
    expect(form).not.toBeNull();
    expect(form![0]).toContain("flex: 1 1 100%");
    expect(form![0]).toContain("margin-left: 0");
    const field = b.match(/\.inv-search \.ui-field \{[^}]*\}/);
    expect(field).not.toBeNull();
    expect(field![0]).toContain("min-width: 0");
  });
});

describe("internal notes label (#1221)", () => {
  test("the label renders in sentence case on the type scale — no uppercase eyebrow", () => {
    const rule = css.match(/\.internal-notes-label \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("font-size: var(--font-size-sm)");
    expect(rule![0]).not.toContain("text-transform");
    expect(rule![0]).not.toContain("letter-spacing");
  });
});
