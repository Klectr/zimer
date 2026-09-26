/** #462: deleting the running entry orphans the timer card (ghost TRACKING +
 *  ticking tab-title until Stop is hit). The card owns the running entry, so
 *  the calendar entry dialog must not offer Delete on it — same rule as the
 *  Today list's entry row (see timer.test.ts).
 */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { createCalendarViews } from "./calendar.ts";

describe("calendar dialog delete guard (#462)", () => {
  test("openEdit hides Delete for running entries, not just locked ones", async () => {
    const src = await Bun.file("site/views/calendar.ts").text();
    const openEdit = src.slice(src.indexOf("function openEdit(el)"), src.indexOf("function close(){"));
    expect(openEdit).toContain("classList.contains('running')");
    expect(openEdit).toMatch(/delBtn\.hidden\s*=\s*!!locked\s*\|\|\s*running/);
  });

  test("grid marks running entries so openEdit can find them", async () => {
    const src = await Bun.file("site/views/calendar.ts").text();
    expect(src).toContain('cal-entry${running ? " running" : ""}');
  });
});

/** #479: untitled entries render "No description" in <em> markup — the week
 *  grid's aria-label is a plain-text accessible name and must not carry it. */
describe("calendar entry aria-label (#479)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });

  const untitled = {
    id: 11, description: null, project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T15:00:00.000Z", end_time: "2026-09-21T16:00:00.000Z",
  };
  const titled = {
    id: 12, description: 'fix "quotes" & ampersands', project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T17:00:00.000Z", end_time: "2026-09-21T18:00:00.000Z",
  };

  function weekInnerHtml(entries: unknown[]) {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => entries }),
    } as unknown as Database;
    const views = createCalendarViews({
      db,
      qOne: stubQuery(),
      qRange: stubQuery(),
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
    return views.weekInner("2026-09-20", "America/Chicago");
  }

  function labelFor(html: string, id: number): string {
    const m = html.match(new RegExp(`data-id="${id}"[^>]*aria-label="([^"]*)"`));
    if (!m) throw new Error(`no cal-entry with data-id=${id}`);
    return m[1];
  }

  test("untitled entry's label is plain text, not <em> markup", () => {
    const html = weekInnerHtml([untitled, titled]);
    const label = labelFor(html, 11);
    expect(label).not.toContain("<");
    expect(label).toContain("No description");
    expect(label).toContain("1h 00m");
  });

  test("described entry keeps its (escaped) description in the label", () => {
    const html = weekInnerHtml([untitled, titled]);
    const label = labelFor(html, 12);
    expect(label).toContain("fix &quot;quotes&quot; &amp; ampersands");
  });
});

/** #486: finish the data-tip sweep — week-nav chevrons used the OS-native
 *  title= tooltip while the rest of the app shows M3 plain tooltips. */
describe("week-nav tooltips (#486)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });
  function headerHtml() {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => [] }),
    } as unknown as Database;
    const views = createCalendarViews({
      db,
      qOne: stubQuery(),
      qRange: stubQuery(),
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
    // the week-nav chevrons render in weekInner's header
    return views.weekInner("2026-09-20", "America/Chicago");
  }
  test("prev/next chevrons use data-tip, not the native title", () => {
    const html = headerHtml();
    expect(html).toContain('data-tip="Previous week"');
    expect(html).toContain('data-tip="Next week"');
    expect(html).not.toContain('title="Previous week"');
    expect(html).not.toContain('title="Next week"');
  });
});

/** #500: finish the data-tip sweep — the calendar entry card's invoiced-mark
 *  info was the last native title= tooltip on the grid; it now uses the house
 *  M3 plain tooltip (data-tip) like the timer page's inv-mark chip (#498). */
describe("calendar entry invoiced-mark tooltip (#500)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });
  const plain = {
    id: 20, description: "plain entry", project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T15:00:00.000Z", end_time: "2026-09-21T16:00:00.000Z",
  };
  const invoiced = {
    id: 21, description: "billed work", project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: 5,
    invoice_number: "INV-0042", invoice_status: "sent",
    start_time: "2026-09-21T17:00:00.000Z", end_time: "2026-09-21T18:00:00.000Z",
  };
  function weekInnerHtml(entries: unknown[]) {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => entries }),
    } as unknown as Database;
    const views = createCalendarViews({
      db,
      qOne: stubQuery(),
      qRange: stubQuery(),
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
    return views.weekInner("2026-09-20", "America/Chicago");
  }
  function cardTag(html: string, id: number): string {
    const m = html.match(new RegExp(`<div class="cal-entry[^>]*data-id="${id}"[^>]*>`));
    if (!m) throw new Error(`no cal-entry card with data-id=${id}`);
    return m[0];
  }
  test("invoiced entry card uses data-tip, not the native title", () => {
    const html = weekInnerHtml([plain, invoiced]);
    const tag = cardTag(html, 21);
    expect(tag).toContain('data-tip="Invoiced on INV-0042"');
    expect(tag).not.toContain("title=");
  });
  test("plain entries get no mark tip at all", () => {
    const html = weekInnerHtml([plain, invoiced]);
    const tag = cardTag(html, 20);
    expect(tag).not.toContain("data-tip=");
    expect(tag).not.toContain("title=");
  });
  test("resize handles carry no native title", () => {
    // both stubs are 1h, not running, not locked → resizable handles render
    const html = weekInnerHtml([plain, invoiced]);
    expect(html).toContain('data-resize="start"');
    expect(html).toContain('data-resize="end"');
    expect(html).not.toContain("title=");
  });
});

/** Day stack: narrow containers reflow the 7 lanes into full-width stacked
 *  day sections — pure CSS via [data-stacked], no view modes. The server
 *  trims each day to its entries (±1h) through --lo/--span. */
describe("calendar day stack", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });

  const monEntry = {
    id: 31, description: "monday work", project_id: 5, project_name: "P",
    client_name: "Acme", client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T14:00:00.000Z", end_time: "2026-09-21T16:00:00.000Z",
  };
  const tueEntry = {
    id: 32, description: "tuesday work", project_id: 5, project_name: "P",
    client_name: "Acme", client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-22T14:00:00.000Z", end_time: "2026-09-22T15:00:00.000Z",
  };

  function viewsFor(entries: unknown[]) {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => entries }),
    } as unknown as Database;
    return createCalendarViews({
      db,
      qOne: stubQuery(),
      qRange: stubQuery(),
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
  }

  const laneCount = (html: string) => (html.match(/class="cal-day[ "]/g) || []).length;
  const laneTag = (html: string, date: string) => {
    // lane opens only: `cal-day` followed by space or quote (not cal-day-head etc.)
    const re = /<div class="cal-day([ "][^>]*)>/g;
    const opens: { tag: string; index: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) opens.push({ tag: m[0], index: m.index });
    for (let i = 0; i < opens.length; i++) {
      const end = i + 1 < opens.length ? opens[i + 1].index : html.length;
      if (html.slice(opens[i].index, end).includes(`data-date="${date}"`)) return opens[i].tag;
    }
    throw new Error(`no cal-day lane for ${date}`);
  };

  test("dayTrim is empty-aware and pads ±1h", () => {
    const { dayTrim } = viewsFor([]);
    expect(dayTrim([])).toEqual({ lo: 0, span: 0 });
    // 9:00–11:00 → 8:00–12:00
    expect(dayTrim([{ a: 540, b: 660 }])).toEqual({ lo: 8, span: 4 });
    // multi-block spans the extremes
    expect(dayTrim([{ a: 540, b: 600 }, { a: 840, b: 1020 }])).toEqual({ lo: 8, span: 10 });
  });

  test("dayTrim clamps to the 0–24 day", () => {
    const { dayTrim } = viewsFor([]);
    expect(dayTrim([{ a: 30, b: 60 }])).toEqual({ lo: 0, span: 2 });
    expect(dayTrim([{ a: 1320, b: 1410 }])).toEqual({ lo: 21, span: 3 });
  });

  test("each lane carries its --lo/--span trim", () => {
    const html = viewsFor([monEntry, tueEntry]).weekInner("2026-09-20", "America/Chicago");
    expect(laneCount(html)).toBe(7);
    // monday 9:00–11:00 CDT → --lo:8;--span:4 ; tuesday 9:00–10:00 CDT → --lo:8;--span:3
    expect(laneTag(html, "2026-09-21")).toContain("--lo:8;--span:4");
    expect(laneTag(html, "2026-09-22")).toContain("--lo:8;--span:3");
  });

  test("lanes wrap the column in body/shift with a per-day gutter", () => {
    const html = viewsFor([monEntry]).weekInner("2026-09-20", "America/Chicago");
    const gutters = html.match(/class="cal-day-gutter cal-hours"/g) || [];
    expect(gutters.length).toBe(7);
    const labels = html.match(/class="cal-hour-label/g) || [];
    // 24 labels × 7 per-day gutters + 24 in the shared week gutter
    expect(labels.length).toBe(24 * 8);
    expect(html).toContain('class="cal-day-body"');
    expect(html).toContain('class="cal-day-shift"');
  });

  test("empty days collapse with a hint", () => {
    const html = viewsFor([monEntry]).weekInner("2026-09-20", "America/Chicago");
    // wednesday has no entries
    const tag = laneTag(html, "2026-09-23");
    expect(tag).toContain("--span:0");
    expect(tag).toContain("cal-empty");
    expect(html).toContain("cal-empty-hint");
  });

  test("entries stay 24h-relative (no stacked-mode position math)", () => {
    const html = viewsFor([monEntry]).weekInner("2026-09-20", "America/Chicago");
    // 9:00 at 64px/hour → top:578.0px (576 + 2px inset), height 126px (2h − 4px inset)
    const m = html.match(/<div class="cal-entry[^>]*data-id="31"[^>]*>/);
    if (!m) throw new Error("entry 31 not rendered");
    expect(m[0]).toContain("top:578.0px");
  });

  test("no view modes remain — one grid, one partial, one attribute", () => {
    const views = viewsFor([monEntry]);
    const html = views.weekInner("2026-09-20", "America/Chicago");
    expect(html).not.toContain("data-mode=");
    expect(html).not.toContain("/partial/day");
    expect(html).toContain('id="cal-body"');
    const page = views.calendarPage("2026-09-20");
    expect(page).not.toContain("DAY_BREAK");
    expect(page).not.toContain("initMode");
    expect(page).toContain("data-stacked");
    expect(page).toContain("STACK_BREAK");
  });

  test("weekGrid always loads the week partial with the 7-lane skeleton", () => {
    const html = viewsFor([]).weekGrid("2026-09-20");
    expect(html).toContain('hx-get="/partial/week?week=2026-09-20"');
    expect(html).not.toContain("/partial/day");
    expect(html).not.toContain("data-mode=");
  });

  test("supporting pane stays week-scoped", () => {
    const html = viewsFor([monEntry, tueEntry]).weekInner("2026-09-20", "America/Chicago");
    // 2h monday + 1h tuesday = 3h week total, all billable
    expect(html).toContain("3h 00m");
    expect(html).toContain("Acme");
    expect(html).toContain("Invoice this week");
    expect(html).toContain('aria-label="Previous week"');
  });
});
