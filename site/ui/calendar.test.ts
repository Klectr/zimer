import { describe, expect, test } from "bun:test";
import { weekView, type WeekDay } from "./week-view";
import { visualizer } from "./visualizer";

const DAY: WeekDay = {
  weekday: "Mon",
  dateLabel: "Nov 2",
  total: "6h 24m",
  entries: [
    { title: "A", meta: "9 AM", duration: "1h" },
    { title: "B", meta: "10 AM", duration: "1h" },
    { title: "C", meta: "11 AM", duration: "1h" },
    { title: "D", meta: "12 PM", duration: "1h" },
    { title: "E", meta: "1 PM", duration: "1h" },
  ],
};

describe("weekView", () => {
  test("grid caps at 4 entries per day with a +N more line", () => {
    const html = weekView({ days: [DAY] });
    expect(html).toContain('<div class="ui-day-more">+1 more</div>');
    expect(html).toContain("ui-week-grid");
    expect(html).toContain("ui-week-agenda");
  });

  test("today gets the dot and today class in both layouts", () => {
    const html = weekView({ days: [{ ...DAY, isToday: true, entries: [] }] });
    expect(html).toContain("ui-day is-today");
    expect(html).toContain("ui-day-dot");
  });

  test("agenda shows the empty-day line", () => {
    const html = weekView({ days: [{ ...DAY, entries: [] }] });
    expect(html).toContain("No entries");
  });

  test("entry state flows through: agenda rows get running and the Zinvoiced mark", () => {
    const html = weekView({
      days: [{ ...DAY, entries: [
        { title: "Live", meta: "9 AM", duration: "0h 12m", running: true },
        { title: "Billed", meta: "10 AM", duration: "1h", invoiced: true },
      ]}],
    });
    expect(html).toContain("is-running");
    expect(html).toContain("· Zinvoiced");
    expect(html).toContain("Running · 0h 12m");
  });

  test("an empty agenda day with a logHref offers the Log time action", () => {
    const html = weekView({ days: [{ ...DAY, entries: [], logHref: "/timer" }] });
    expect(html).toContain('<a class="ui-btn ui-btn-ghost ui-btn-sm" href="/timer">Log time</a>');
  });
});

const VDAY = { date: "2026-11-02", label: "Mon Nov 2", total: "2h", entries: [] };

describe("visualizer", () => {
  test("positions blocks with the real math (top offset +2, height -4, min 22)", () => {
    const html = visualizer({
      days: [{ ...VDAY, entries: [{ id: "e1", title: "Pass", startMin: 540, endMin: 660 }] }],
    });
    expect(html).toContain('style="top:146px;height:92px"');
  });

  test("emits the real script's data-hook contract (HH:MM strings, date, locked)", () => {
    const html = visualizer({
      days: [{ ...VDAY, entries: [{ id: "e1", title: "Pass", startMin: 540, endMin: 660, locked: true, projectId: "p1", desc: "work" }] }],
    });
    expect(html).toContain('data-start="09:00"');
    expect(html).toContain('data-end="11:00"');
    expect(html).toContain('data-date="2026-11-02"');
    expect(html).toContain('data-project-id="p1"');
    expect(html).toContain('data-desc="work"');
    expect(html).toContain('data-locked="1"');
  });

  test("running and locked blocks have no handles; short blocks neither; invoiced are marked", () => {
    const html = visualizer({
      days: [
        {
          ...VDAY,
          entries: [
            { id: "r", title: "Live", startMin: 540, endMin: 600, running: true },
            { id: "l", title: "Billed", startMin: 660, endMin: 780, invoiced: true, locked: true },
            { id: "s", title: "Short", startMin: 840, endMin: 870 },
            { id: "n", title: "Normal", startMin: 900, endMin: 1020 },
          ],
        },
      ],
    });
    expect(html).toContain("is-running");
    expect(html).toContain("is-invoiced");
    expect(html).toContain("is-locked");
    expect(html.match(/data-resize/g)?.length).toBe(2);
  });

  test("blocks are focusable buttons with spoken labels; running reads as start – now", () => {
    const html = visualizer({
      days: [{ ...VDAY, entries: [{ id: "r", title: "Live", startMin: 540, endMin: 600, running: true }] }],
    });
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain("9:00 AM – now");
    expect(html).toContain(", running");
  });

  test("overlap blocks get the layered-shadow class", () => {
    const html = visualizer({
      days: [{ ...VDAY, entries: [{ id: "o", title: "Over", startMin: 540, endMin: 660, overlap: true }] }],
    });
    expect(html).toContain("is-overlap");
  });

  test("day headers carry labels, totals, and the today marker", () => {
    const html = visualizer({ days: [{ ...VDAY, isToday: true }] });
    expect(html).toContain("ui-viz-day-head is-today");
    expect(html).toContain("data-day-total");
    expect(html).toContain("Mon Nov 2");
  });

  test("day headers carry the day detail in the tooltip component", () => {
    const html = visualizer({
      days: [{ ...VDAY, detail: "Monday Nov 2 · 2h tracked · 0 entries" }],
    });
    expect(html).toContain('class="ui-tooltip is-bottom is-align-start"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Monday Nov 2 · 2h tracked · 0 entries");
    expect(html).toContain("ui-viz-day-inner");
  });

  test("now line renders only on today's column, inside the window", () => {
    const html = visualizer({
      nowMin: 600,
      days: [{ ...VDAY, isToday: true }, { ...VDAY }],
    });
    expect(html.match(/ui-viz-now/g)?.length).toBe(1);
    expect(visualizer({ nowMin: 120, days: [{ ...VDAY, isToday: true }] })).not.toContain("ui-viz-now");
    expect(visualizer({ days: [{ ...VDAY, isToday: true }] })).not.toContain("ui-viz-now");
  });

  test("hour gutter spans the configured range in compact labels", () => {
    const html = visualizer({ days: [{ ...VDAY }] });
    expect(html).toContain(">6 AM<");
    expect(html).toContain(">6 PM<");
  });
});
