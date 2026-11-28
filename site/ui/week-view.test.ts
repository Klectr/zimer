import { describe, expect, test } from "bun:test";
import { weekView, type WeekDay } from "./week-view";

const entry = { title: "Brand refresh", meta: "9:00 AM – 10:00 AM", duration: "1h" };
const day = (weekday: string, n: number, opts: Partial<WeekDay> = {}): WeekDay => ({
  weekday, dateLabel: `Nov ${n}`, total: "", date: `2026-11-${String(n).padStart(2, "0")}`, entries: [], ...opts,
});

const gaps = (html: string) => html.match(/<details class="ui-agenda-gap">/g)?.length ?? 0;
const sections = (html: string) => html.match(/class="ui-agenda-day"/g)?.length ?? 0;

/** #1219 item 7: consecutive empty days collapse into one expandable row so
 *  the phone agenda doesn't open on a stack of "No entries" sections. */
describe("agenda collapses runs of empty days (#1219)", () => {
  test("two or more consecutive empty days become one details row", () => {
    const html = weekView({ agendaOnly: true, days: [
      day("Sun", 8), day("Mon", 9), day("Tue", 10),
      day("Wed", 11, { entries: [entry] }),
    ] });
    expect(gaps(html)).toBe(1);
    expect(html).toContain("Sun Nov 8 – Tue Nov 10</span>");
    expect(html).toContain('<span class="ui-agenda-gap-note">No entries</span>');
    expect(sections(html)).toBe(4);
  });

  test("a single empty day between entries stays a plain section", () => {
    const html = weekView({ agendaOnly: true, days: [
      day("Sun", 8, { entries: [entry] }), day("Mon", 9), day("Tue", 10, { entries: [entry] }),
    ] });
    expect(gaps(html)).toBe(0);
  });

  test("today is never collapsed, and it splits a run", () => {
    const html = weekView({ agendaOnly: true, days: [
      day("Sun", 8), day("Mon", 9, { isToday: true }), day("Tue", 10), day("Wed", 11), day("Thu", 12),
    ] });
    expect(gaps(html)).toBe(1);
    expect(html).toContain("Tue Nov 10 – Thu Nov 12</span>");
    const mon = html.indexOf('data-date="2026-11-09"');
    const gap = html.indexOf("<details");
    expect(mon).toBeGreaterThan(-1);
    expect(mon).toBeLessThan(gap);
  });

  test("a trailing empty run collapses too", () => {
    const html = weekView({ agendaOnly: true, days: [
      day("Thu", 12, { entries: [entry] }), day("Fri", 13), day("Sat", 14),
    ] });
    expect(gaps(html)).toBe(1);
    expect(html).toContain("Fri Nov 13 – Sat Nov 14</span>");
  });

  test("the grid half of the full week view is unaffected", () => {
    const html = weekView({ days: [day("Sun", 8), day("Mon", 9)] });
    const grid = html.slice(0, html.indexOf('<div class="ui-week-agenda">'));
    expect(grid).not.toContain("<details");
  });
});
