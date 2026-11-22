import { describe, expect, test } from "bun:test";
import { indicatorStories } from "./indicators.stories";
import { shareLineStories } from "./share-line.stories";
import { timeBreakdownStories } from "./time-breakdown.stories";
import config from "../zandbox.config";

const render = (ss: { render: () => string }[]) => ss.map((s) => s.render()).join("");

describe("small component stories", () => {
  test("target bar shows stacked and inline, met and over", () => {
    const all = render(indicatorStories);
    expect(all).toContain('class="ui-target"');
    expect(all).toContain('class="ui-target ui-target-inline"');
    expect(all).toContain("Target met");
    expect(all).toContain("over target");
  });
  test("trend delta, invoice mark, Stripe chip and skeleton render", () => {
    const all = render(indicatorStories);
    for (const t of ["12% up", "8% down", "0% unchanged", "ui-inv-mark", "stripe-paid-chip", "skel-stack"]) expect(all).toContain(t);
  });
  test("share line covers link, action-only, warning and note", () => {
    const all = render(shareLineStories);
    for (const t of ['class="share-url-wrap"', "Create client link", 'class="share-label warn"', "share-line-wrap"]) expect(all).toContain(t);
  });
  test("time breakdown draws per-day and per-week bars", () => {
    const all = render(timeBreakdownStories);
    expect(all).toContain("Tracked time per day");
    expect(all).toContain("Tracked time per week");
    expect((all.match(/class="tb-bar"/g) || []).length).toBe(11);
  });
  test("every story file here is registered, and no page-section stories remain", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of [...indicatorStories, ...shareLineStories, ...timeBreakdownStories]) expect(ids).toContain(s.id);
    for (const gone of ["zinvoice-wizard-lines", "calendar-pane-this-week", "timer-home-today", "zinvoice-detail-status", "zinvoices-filter-bar", "public-product-preview"]) expect(ids).not.toContain(gone);
  });
});
