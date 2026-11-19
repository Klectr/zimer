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

describe("style.css token references", () => {
  test("every var() reference resolves to a definition (or an inline-set legacy var)", () => {
    const defs = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const refs = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    const unresolved = [...refs].filter((r) => !defs.has(r) && !INLINE_SET_VARS.includes(r));
    expect(unresolved).toEqual([]);
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
