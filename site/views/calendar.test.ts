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
    expect(label).toContain("1h"); /* #817: whole hours drop the 00m */
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

/** #554: the next chevron sits at the summary pane's right edge — its
 *  centered tooltip hangs past the edge and the pane (overflow-y: auto)
 *  renders a horizontal scrollbar. Right-edge buttons use tip-right,
 *  the same class the invoice actions already use. */
describe("calendar nav edge tooltips (#554, #572)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });
  function views() {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => [] }),
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
  test("week mode: next-week chevron right-aligns its tooltip", () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    expect(html).toContain('class="md-icon-button tip-right" href="/calendar?week=2026-09-27"');
    expect(html).not.toContain('class="md-icon-button tip-right" href="/calendar?week=2026-09-13"');
  });
  test("carousel: chevrons step a full week in each direction", () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    expect(html).toContain('href="/calendar?week=2026-09-13"');
    expect(html).toContain('href="/calendar?week=2026-09-27"');
    expect(html).toContain('hx-push-url="/calendar?week=2026-09-13"');
    expect(html).toContain('hx-push-url="/calendar?week=2026-09-27"');
  });
});

/** #572: the week carousel — three pre-rendered week strips (prev/current/next)
 *  in an overflow-hidden viewport; chevron pans translate the track ±100%.
 *  The chevrons carry a data-slide direction the client script intercepts;
 *  hrefs stay as the no-JS fallback. */
describe("calendar week carousel (#572)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });
  function views() {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => [] }),
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
  const stripCount = (html: string) => (html.match(/class="cal-strip"/g) || []).length;
  const laneCount = (html: string) => (html.match(/class="cal-day[ "]/g) || []).length;

  test("weekInner renders three strips tagged with their Sundays", () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    expect(stripCount(html)).toBe(3);
    expect(html).toContain('data-sun="2026-09-13"');
    expect(html).toContain('data-sun="2026-09-20"');
    expect(html).toContain('data-sun="2026-09-27"');
  });
  test("each strip renders seven day lanes", () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    expect(laneCount(html)).toBe(21);
  });
  test("the track starts centered on the current week", async () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    expect(html).toContain("cal-track");
    // the resting position lives in the stylesheet (initCarousel also sets it)
    const css = await Bun.file("site/static/style.css").text();
    expect(css).toMatch(/\.cal-track\s*\{[^}]*transform:\s*translateX\(-100%\)/);
  });
  test("chevrons carry slide directions and keep htmx fallbacks", () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    expect(html).toContain('data-slide="prev" data-tip="Previous week"');
    expect(html).toContain('data-slide="next" data-tip="Next week"');
    expect(html).toContain('hx-get="/partial/week?week=2026-09-13"');
    expect(html).toContain('hx-push-url="/calendar?week=2026-09-13"');
  });
  test("each strip carries its week's pane in a template", () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    expect((html.match(/class="cal-pane-tpl"/g) || []).length).toBe(3);
  });
  test("the supporting pane sits outside the moving track", () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    const asideAt = html.indexOf('class="cal-supporting"');
    const trackAt = html.indexOf('class="cal-track"');
    expect(asideAt).toBeGreaterThan(-1);
    expect(trackAt).toBeGreaterThan(-1);
    expect(asideAt).toBeLessThan(trackAt);
  });
  test("weekStrip renders one week's inner HTML", () => {
    const html = views().weekStrip("2026-09-20", "America/Chicago");
    expect(laneCount(html)).toBe(7);
    expect(html).toContain('data-date="2026-09-20"');
    expect(html).toContain('data-date="2026-09-26"');
    expect(html).not.toContain('class="cal-strip"');
    expect(html).toContain('class="cal-pane-tpl"');
  });
  test("dayInner is gone", () => {
    expect((views() as any).dayInner).toBeUndefined();
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
    expect(tag).toContain('data-tip="Zinvoiced on INV-0042"');
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

/** #572: week-only calendar — the three-day strip is gone; every strip is a
 *  full week, and narrow strips get a seven-section agenda instead of hour
 *  lanes. */
describe("calendar week-only carousel (#572)", () => {
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

  function viewsFor(entries: unknown[], qRangeEntries: unknown[] = []) {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => entries }),
    } as unknown as Database;
    const qr = {
      get: (..._a: unknown[]) => ({ n: 1 }),
      all: (..._a: unknown[]) => qRangeEntries,
    };
    return createCalendarViews({
      db,
      qOne: stubQuery(),
      qRange: qr,
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
  }

  const laneCount = (html: string) => (html.match(/class="cal-day[ "]/g) || []).length;
  const agSectionCount = (html: string) => (html.match(/class="cal-ag-day[ "]/g) || []).length;

  test("weekInner renders three full weeks: 21 lanes and 21 agenda sections", () => {
    const html = viewsFor([monEntry, tueEntry]).weekInner("2026-09-20", "America/Chicago");
    expect(laneCount(html)).toBe(21);
    expect(agSectionCount(html)).toBe(21);
  });

  test("strips cover the previous, current, and next week", () => {
    const html = viewsFor([]).weekInner("2026-09-20", "America/Chicago");
    expect(html).toContain('data-sun="2026-09-13"');
    expect(html).toContain('data-sun="2026-09-20"');
    expect(html).toContain('data-sun="2026-09-27"');
  });

  test("agenda rows carry the entry's data attributes", () => {
    const html = viewsFor([monEntry]).weekInner("2026-09-20", "America/Chicago");
    expect(html).toContain('data-id="31"');
    expect(html).toContain('data-desc="monday work"');
    expect(html).toContain('data-date="2026-09-21"');
    expect(html).toContain('data-start="09:00"');
  });

  test("every agenda day gets an add button", () => {
    const html = viewsFor([]).weekInner("2026-09-20", "America/Chicago");
    // 7 per strip x 3 strips
    expect((html.match(/data-ag-new="/g) || []).length).toBe(21);
    expect(html).toContain('aria-label="Log time Monday"');
  });

  /* #592: the live aside shows the viewed week's chip; the pre-rendered strip
     templates carry their own weeks' chips, so scope assertions to the aside. */
  const asideOf = (html: string) =>
    html.slice(html.indexOf('<aside class="cal-supporting"'), html.indexOf("</aside>"));

  test("the supporting pane stays week-scoped", () => {
    const html = viewsFor([monEntry, tueEntry]).weekInner("2026-09-20", "America/Chicago");
    // 2h monday + 1h tuesday = 3h week total, all billable (#817: no 00m)
    expect(html).toContain("3h");
    expect(html).toContain("Acme");
    // #592: 2026-09-20 is a past week, so the chip invoices "this period"
    const aside = asideOf(html);
    expect(aside).toContain("Zinvoice this period");
    expect(aside).not.toContain("Zinvoice this week");
  });

  test("nudge chip says \"Zinvoice this week\" on the current week (#592)", () => {
    const aside = asideOf(viewsFor([monEntry, tueEntry]).weekInner(undefined, "America/Chicago"));
    expect(aside).toContain("Zinvoice this week");
    expect(aside).not.toContain("Zinvoice this period");
  });

  test("nudge chip omits the amount when no billable time is invoiced yet (#1035)", () => {
    const aside = asideOf(viewsFor([monEntry, tueEntry]).weekInner("2026-09-20", "America/Chicago"));
    expect(aside).toContain("nudge-chip");
    expect(aside).not.toContain("not yet zinvoiced");
  });

  test("nudge chip shows the amount once part of the week is invoiced (#1035)", () => {
    const invoicedMon = { ...monEntry, invoice_id: 7, invoice_number: "INV-0001", invoice_status: "sent" };
    const aside = asideOf(viewsFor([invoicedMon, tueEntry]).weekInner("2026-09-20", "America/Chicago"));
    expect(aside).toContain("1h not yet zinvoiced");
  });

  test("slim chip rides inline in the summary, beside the total (#1041)", () => {
    const aside = asideOf(viewsFor([monEntry, tueEntry]).weekInner("2026-09-20", "America/Chicago"));
    expect(aside).toContain("nudge-chip nudge-chip--solo");
    expect(aside).toMatch(/cal-summary">[\s\S]*?nudge-chip--solo[\s\S]*?<\/a>\s*<\/div>/);
  });

  test("amount chip keeps its full-width row: no solo placement (#1041)", () => {
    const invoicedMon = { ...monEntry, invoice_id: 7, invoice_number: "INV-0001", invoice_status: "sent" };
    const aside = asideOf(viewsFor([invoicedMon, tueEntry]).weekInner("2026-09-20", "America/Chicago"));
    expect(aside).toContain("nudge-chip");
    expect(aside).not.toContain("nudge-chip--solo");
  });

  test("weekGrid loads the week skeleton with no day param", () => {
    const html = viewsFor([]).weekGrid("2026-09-20");
    expect(html).toContain('hx-get="/partial/week?week=2026-09-20"');
    expect(html).toContain("cal-carousel");
    expect(html).not.toContain("/partial/day");
  });

  test("weekStrip fills one recycled strip", () => {
    const html = viewsFor([monEntry]).weekStrip("2026-09-20", "America/Chicago");
    expect(html).toContain("monday work");
    expect(html).toContain('data-date="2026-09-20"');
    expect(laneCount(html)).toBe(7);
    expect(agSectionCount(html)).toBe(7);
  });

  test("no day mode survives", () => {
    const html = viewsFor([]).weekInner("2026-09-20", "America/Chicago");
    expect(html).not.toContain("data-mode=");
    expect(html).not.toContain("/partial/day");
  });
});

/** #524:/** #524: the supporting-pane summary's week-over-week delta slot — with no
 *  previous-week billable time, the "· —" placeholder reads like a
 *  half-loaded widget, so the delta (and its separator) is omitted. */
describe("week summary delta (#524)", () => {
  const entry = {
    id: 21, description: "work", project_id: 3, project_name: "p",
    client_name: "Acme", client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T15:00:00.000Z", end_time: "2026-09-21T16:00:00.000Z",
  };

  function summaryHtml(prevRows: unknown[]) {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => [entry] }),
    } as unknown as Database;
    const views = createCalendarViews({
      db,
      qOne: { get: (..._a: unknown[]) => ({ n: 1 }), all: (..._a: unknown[]) => [] },
      qRange: { get: (..._a: unknown[]) => ({ n: 1 }), all: (..._a: unknown[]) => prevRows },
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
    const html = views.weekInner("2026-09-20", "America/Chicago");
    const m = html.match(/<div class="cal-summary">[\s\S]*?cal-summary-sub">[\s\S]*?<\/div>/);
    if (!m) throw new Error("no cal-summary block");
    return m[0];
  }

  test("no previous-week data: billable figure stands alone, no dash", () => {
    const s = summaryHtml([]);
    expect(s).toContain("1h billable"); /* #817: whole hours drop the 00m */
    expect(s).not.toContain("·");
    expect(s).not.toContain("—");
  });

  test("previous-week data present: delta shows with separator", () => {
    const prev = [{ ...entry, start_time: "2026-09-14T15:00:00.000Z", end_time: "2026-09-14T16:00:00.000Z" }];
    const s = summaryHtml(prev);
    expect(s).toContain("vs prev week");
    expect(s).toContain("·");
  });

  /** #542: the delta's trend marker is an icon-system SVG, never a text
   *  glyph — and the direction survives for assistive tech via the span's
   *  accessible label (the svg itself is aria-hidden). */
  test("delta uses an icon, not an arrow glyph; direction in the label", () => {
    const prev = [{ ...entry, start_time: "2026-09-14T15:00:00.000Z", end_time: "2026-09-14T15:30:00.000Z" }];
    const s = summaryHtml(prev);
    expect(s).not.toContain("↑");
    expect(s).not.toContain("↓");
    expect(s).not.toContain("→");
    expect(s).toContain("<svg");
    expect(s).toContain('aria-label="100% up vs prev week"');
    expect(s).toContain("M22 7l-8.5 8.5-5-5L2 17"); /* trend_up path */
  });

  test("flat delta: trend_flat with an unchanged label", () => {
    const prev = [{ ...entry, start_time: "2026-09-14T15:00:00.000Z", end_time: "2026-09-14T16:00:00.000Z" }];
    const s = summaryHtml(prev);
    expect(s).toContain('aria-label="0% unchanged vs prev week"');
    expect(s).toContain("M4 12h16"); /* trend_flat path */
  });

  /** #590: the direction word must appear in the VISIBLE delta text (after
   *  the closing svg), not only in the aria-label — "100% vs prev week"
   *  alone reads ambiguous at a glance. */
  test("direction word is visible text, not label-only", () => {
    const up = summaryHtml([{ ...entry, start_time: "2026-09-14T15:00:00.000Z", end_time: "2026-09-14T15:30:00.000Z" }]);
    expect(up).toMatch(/<\/svg>\s*100% up vs prev week</);
    /* current week is the fixed 1h entry above; a 2h previous week gives
       a -50% delta, i.e. the down case. */
    const down = summaryHtml([{ ...entry, start_time: "2026-09-14T15:00:00.000Z", end_time: "2026-09-14T17:00:00.000Z" }]);
    expect(down).toMatch(/<\/svg>\s*50% down vs prev week</);
  });
});

/** #530: entry cards are tabindex="0" role="button" — Enter/Space must
 *  activate them (openEdit), not just land focus on them. */
describe("calendar entry keyboard activation (#530)", () => {
  test("keydown handler opens the dialog on Enter/Space over an entry card", async () => {
    const src = await Bun.file("site/views/calendar.ts").text();
    const handler = src.slice(
      src.indexOf("document.addEventListener('keydown'"),
      src.indexOf("function fail(msg)")
    );
    expect(handler).toContain("e.key==='Enter'");
    expect(handler).toContain("e.key===' '");
    expect(handler).toMatch(/closest\('\.cal-entry,.cal-ag-row'\)/);
    expect(handler).toContain("openEdit(card)");
    expect(handler).toContain("e.preventDefault()");
  });
});

/** #578: the entry dialog's description field gets the same 15-recent-
 *  descriptions datalist the timer start form has (#546) — zero visual
 *  surface until typed in, own id so it can't collide with the timer page. */
describe("calendar dialog description suggestions (#578)", () => {
  function dialogHtml(descRows: { description: string }[]) {
    const db = {
      query: (sql: string) => ({
        get: () => ({ n: 1 }),
        all: () => (sql.includes("GROUP BY description") ? descRows : []),
      }),
    } as unknown as Database;
    const views = createCalendarViews({
      db,
      qOne: null,
      qRange: null,
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
    return views.weekGrid("2026-09-27");
  }

  test("dialog wires a suggestion datalist, values HTML-escaped", () => {
    const s = dialogHtml([
      { description: "deep work" },
      { description: 'fix "quotes" & ampersands' },
    ]);
    expect(s).toContain('list="tk-desc-suggest-dialog"');
    expect(s).toContain('<datalist id="tk-desc-suggest-dialog">');
    expect(s).toContain('<option value="deep work">');
    expect(s).toContain('<option value="fix &quot;quotes&quot; &amp; ampersands">');
  });

  test("no datalist when nothing has been described yet", () => {
    const s = dialogHtml([]);
    expect(s).toContain('list="tk-desc-suggest-dialog"');
    expect(s).not.toContain("<datalist");
  });
});

/** #669: the entry dialog must live OUTSIDE #week. The carousel restructure
 *  nested it inside, so the initial /partial/week htmx swap (and every
 *  refreshWeek) destroyed the scrim while calScript's closures kept pointing
 *  at the detached node — slot clicks then silently did nothing. */
describe("calendar dialog placement (#669)", () => {
  function viewsFor() {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => [] }),
    } as unknown as Database;
    return createCalendarViews({
      db,
      qOne: { get: (..._a: unknown[]) => ({ n: 1 }) },
      qRange: { get: (..._a: unknown[]) => ({ n: 1 }), all: (..._a: unknown[]) => [] },
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
  }

  /* Index of the </div> that closes #week (scanning only up to the inline
     <script>, whose JS string literals would confuse the tag walk). */
  function weekCloseIndex(html: string): number {
    const head = html.slice(0, html.indexOf("<script"));
    const re = /<\/?div\b[^>]*>/g;
    let depth = 0, weekDepth = -1, closed = -1, m: RegExpExecArray | null;
    while ((m = re.exec(head))) {
      if (m[0].startsWith("</")) {
        depth--;
        if (weekDepth >= 0 && depth === weekDepth && closed < 0) closed = m.index;
      } else {
        if (m[0].includes('id="week"')) weekDepth = depth;
        depth++;
      }
    }
    return closed;
  }

  test("cal-scrim and the calendar script sit after #week closes, not inside it", () => {
    const html = viewsFor().weekGrid("2026-09-27");
    const closed = weekCloseIndex(html);
    expect(closed).toBeGreaterThan(-1);
    expect(html.indexOf('id="cal-scrim"')).toBeGreaterThan(closed);
    expect(html.indexOf("<script>")).toBeGreaterThan(closed);
  });
});

/** #704: the 30s placeNow tick grows the running card's height as the timer
 *  runs. It never synced the cal-compact class, so a timer started short
 *  kept its 999px pill radius and stretched into an oval until the next
 *  reload. The tick must toggle the class on the true (unfloored) height,
 *  with the same <26px threshold the server render uses. */
describe("running entry pill sync (#704)", () => {
  async function placeNowSrc() {
    const src = await Bun.file("site/views/calendar.ts").text();
    return src.slice(src.indexOf("function placeNow(){"), src.indexOf("/* Scroll one strip"));
  }

  test("placeNow toggles cal-compact on the running entry", async () => {
    const s = await placeNowSrc();
    expect(s).toContain("classList.toggle('cal-compact',trueH<26)");
  });

  test("the toggle keys off the unfloored height, not the 26px floor", async () => {
    const s = await placeNowSrc();
    expect(s).toMatch(/var trueH=\(\(nowMin-sm\)\/60\)\*HOUR;/);
    /* #857: the tick now caps the floor at midnight; the toggle still keys
       off unfloored trueH. */
    expect(s).toMatch(/var capH=\(\(1440-sm\)\/60\)\*HOUR-2;/);
    expect(s).toMatch(/style\.height=Math\.min\(Math\.max\(trueH,26\),Math\.max\(capH,trueH\)\)/);
  });
});

/** #709: the edit-entry page's Description/Project/Start/End fields had
 *  visible floating labels with no for/id wiring and no other accessible
 *  name — screen readers announced nothing and clicking the label did not
 *  focus the field. The calendar dialog already wires for/id; the edit page
 *  must match. */
describe("edit-entry floating labels (#709)", () => {
  function editPageHtml() {
    const entry = {
      id: 7, description: "wired labels", project_id: null,
      start_time: "2026-09-21T15:00:00.000Z", end_time: "2026-09-21T16:00:00.000Z",
      invoice_id: null, invoice_number: null, invoice_status: null,
    };
    const db = { query: (_sql: string) => ({ get: () => null, all: () => [] }) } as unknown as Database;
    const views = createCalendarViews({
      db,
      qOne: { get: () => entry },
      qRange: { get: () => ({ n: 1 }), all: () => [] },
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
    return views.editPage(7) as string;
  }

  test("each field's label is wired to its input via matching id/for", () => {
    const html = editPageHtml();
    for (const id of ["ee-desc", "ee-project", "ee-start", "ee-end"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
  });
});

/** #903: the timer-page edit dialog fragment — same fields as the full edit
 *  page, but as a dialog head + htmx form for #entry-dialog-body. */
describe("entry edit dialog fragment (#903)", () => {
  function dialogViews() {
    const entry = {
      id: 7, description: "dialog entry", project_id: null,
      start_time: "2026-09-21T15:00:00.000Z", end_time: "2026-09-21T16:00:00.000Z",
      invoice_id: null, invoice_number: null, invoice_status: null,
    };
    const db = { query: (_sql: string) => ({ get: () => null, all: () => [] }) } as unknown as Database;
    return createCalendarViews({
      db,
      qOne: { get: () => entry },
      qRange: { get: () => ({ n: 1 }), all: () => [] },
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
  }

  test("fragment carries the dialog head and an htmx form", () => {
    const html = dialogViews().editEntryDialog(7) as string;
    expect(html).toContain('id="entry-dialog-title"');
    expect(html).toContain('hx-post="/entries/7"');
    expect(html).toContain('hx-swap="none"');
    expect(html).toContain('id="edit-entry-form"');
    expect(html).toContain("data-close-entry");
    expect(html).not.toContain("<!DOCTYPE html>");
  });

  test("fragment keeps the #709 label wiring", () => {
    const html = dialogViews().editEntryDialog(7) as string;
    for (const id of ["ee-desc", "ee-project", "ee-start", "ee-end"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
  });

  test("unknown entry is null", () => {
    const db = { query: (_sql: string) => ({ get: () => null, all: () => [] }) } as unknown as Database;
    const views = createCalendarViews({
      db,
      qOne: { get: () => null },
      qRange: { get: () => ({ n: 1 }), all: () => [] },
      entrySelect: "SELECT",
      layout: (_t: string, b: string) => b,
      projectOptions: () => "",
      weekTargetBar: () => "",
      calHourPx: 64,
    } as any);
    expect(views.editEntryDialog(999)).toBeNull();
  });
});

/** #766: the "This week" pane hint named the per-day + buttons, which only
 *  render inside the narrow agenda view (display:none above 639px of strip
 *  width) — at desktop widths the hint pointed at a control that was not
 *  there. The hint is now one sentence that is true at every width.
 */
describe("calendar pane hint (#766)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });
  function views() {
    const db = {
      query: (_sql: string) => ({ get: () => ({ n: 1 }), all: () => [] }),
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
  test("names no viewport-specific control", () => {
    const html = views().weekInner("2026-09-20", "America/Chicago");
    const hint = html.match(/<p class="muted tiny cal-hint">.*?<\/p>/);
    expect(hint).not.toBeNull();
    /* #781: both variants render unconditionally — the server still branches
       on nothing viewport-specific; the client picks by strip width. */
    expect(hint![0]).toBe(
      '<p class="muted tiny cal-hint"><span class="cal-hint-grid">Drag across the calendar to log time. Click an entry to edit it.</span><span class="cal-hint-agenda">Tap + to log time, tap an entry to edit.</span></p>'
    );
  });
});

/** #841: slots stored under the legacy gold default render with the theme
 *  primary variable, so a scheme change needs no data migration. */
describe("calendar slot theme color (#841)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });
  const goldEntry = {
    id: 30, description: "legacy gold client", project_id: null, project_name: null,
    client_name: "Acme", client_color: "#f2c14e", invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T15:00:00.000Z", end_time: "2026-09-21T16:00:00.000Z",
  };
  const blueEntry = { ...goldEntry, id: 31, client_color: "#7cc4ff" };
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
  test("legacy gold client color renders the theme primary variable", () => {
    const tag = cardTag(weekInnerHtml([goldEntry]), 30);
    expect(tag).toContain("--c:var(--md-sys-color-primary)");
    expect(tag).not.toContain("#f2c14e");
  });
  test("explicit client colors pass through untouched", () => {
    const tag = cardTag(weekInnerHtml([blueEntry]), 31);
    expect(tag).toContain("--c:#7cc4ff");
  });
});

/** #845/#847: day columns keep rounded top/bottom corners at every scroll
 *  position. #845 put the rounded top on the sticky header itself, but the
 *  lane's purple night band scrolled underneath and peeked through the
 *  header's rounded corner cutouts (#847). Now the sticky header is opaque
 *  page-bg and square (nothing can peek through it); a ::before top cutter
 *  on the lane re-rounds the lane's visible top edge, and the ::after bottom
 *  cutter re-rounds the visible bottom edge. #849: the top cutter moved from
 *  the header to the lane so it paints below entries (z-0 vs entries z-1) —
 *  the header-anchored cutter bit dark specks out of entries touching the
 *  lane top. #877: the top cutter moved to z-1, above the translucent night
 *  bands (z-auto) — at scroll-top the band's opaque top-12px backing covered
 *  the z-0 cutter, but scrolled past 12px the band's translucent region slid
 *  over the cutter's dark crescents and they read through as notches; above
 *  the band the crescents are clean dark cuts at every scroll offset. Entries
 *  moved to z-2 to stay above the cutters. */
describe("calendar column rounding (#845, #847, #849)", () => {
  test("sticky day header is opaque page-bg and square — no corner cutouts to peek through", async () => {
    const css = await Bun.file("site/static/style.css").text();
    const head = css.match(/body\.app-fixed \.cal-day-head,\s*body\.app-fixed \.cal-gutter-spacer\s*\{[^}]*\}/);
    expect(head).not.toBeNull();
    expect(head![0]).toMatch(/background:\s*var\(--md-sys-color-surface\)/);
    expect(head![0]).not.toMatch(/border-radius/);
  });
  test("top cutter re-rounds the lane's visible top edge directly under the header", async () => {
    const css = await Bun.file("site/static/style.css").text();
    const cutter = css.match(/\.cal-day-col::before\s*\{[^}]*\}/);
    expect(cutter).not.toBeNull();
    expect(cutter![0]).toMatch(/position:\s*sticky/);
    expect(cutter![0]).toMatch(/top:\s*var\(--cal-head-h\)/);
    expect(cutter![0]).toMatch(/z-index:\s*3/);
    expect(cutter![0]).toMatch(/background:\s*var\(--md-sys-color-surface\)/);
    expect(cutter![0]).toMatch(/pointer-events:\s*none/);
    expect(cutter![0]).toMatch(/mask:/);
  });
  test("#849: entries paint above both corner cutters so cutters can't bite them", async () => {
    const css = await Bun.file("site/static/style.css").text();
    const entry = css.match(/\.cal-entry\s*\{[^}]*\}/);
    expect(entry).not.toBeNull();
    expect(entry![0]).toMatch(/z-index:\s*2/);
    const bottomCutter = css.match(/\.cal-day-col::after\s*\{[^}]*\}/);
    expect(bottomCutter).not.toBeNull();
    expect(bottomCutter![0]).toMatch(/z-index:\s*0/);
  });
  test("#877: top cutter paints above the translucent night band so its dark crescents can't show through it", async () => {
    const css = await Bun.file("site/static/style.css").text();
    const cutter = css.match(/\.cal-day-col::before\s*\{[^}]*\}/);
    expect(cutter).not.toBeNull();
    expect(cutter![0]).toMatch(/z-index:\s*3/);
    // night band stays z-auto (below the z-3 cutter, above the lane bg)
    const band = css.match(/\.cal-night\s*\{[^}]*\}/);
    expect(band).not.toBeNull();
    expect(band![0]).not.toMatch(/z-index/);
    // entries stay above the cutter (the #849 fringe fix, now at z-2)
    const entry = css.match(/\.cal-entry\s*\{[^}]*\}/);
    expect(entry).not.toBeNull();
    expect(entry![0]).toMatch(/z-index:\s*2/);
  });
  test("#881: now-dot straddles the lane edge; sticky headers overlap the gutters so the dot hides with the line", async () => {
    const css = await Bun.file("site/static/style.css").text();
    // the dot straddling the lane edge (left:-5px) is the correct design —
    // #880 tucked it inside the lane instead; reverted
    const dot = css.match(/\.cal-now::before\s*\{[^}]*\}/);
    expect(dot).not.toBeNull();
    expect(dot![0]).toMatch(/left:\s*-5px/);
    expect(dot![0]).toMatch(/top:\s*-4px/);
    // each day head overlaps 4px into the gutters on both sides, closing the
    // 8px inter-lane gaps in the header band (the dot's gutter half then
    // hides under the opaque sticky header with the line)
    const head = css.match(/\.cal-grid\s*>\s*\.cal-day\s+\.cal-day-head\s*\{[^}]*\}/);
    expect(head).not.toBeNull();
    expect(head![0]).toMatch(/margin-left:\s*-4px/);
    expect(head![0]).toMatch(/margin-right:\s*-4px/);
    // Sunday is the last grid child — its head must not overhang the grid edge
    const sun = css.match(/\.cal-grid\s*>\s*\.cal-day:nth-child\(8\)\s+\.cal-day-head\s*\{[^}]*\}/);
    expect(sun).not.toBeNull();
    expect(sun![0]).toMatch(/margin-right:\s*0/);
    // the line itself stays full lane width, above entries
    const line = css.match(/\.cal-now\s*\{[^}]*\}/);
    expect(line).not.toBeNull();
    expect(line![0]).toMatch(/left:\s*0/);
    expect(line![0]).toMatch(/right:\s*0/);
    expect(line![0]).toMatch(/z-index:\s*4/);
  });
  test("lane tone is a shared variable across day states", async () => {
    const css = await Bun.file("site/static/style.css").text();
    expect(css).toMatch(/\.cal-day\s*\{\s*--lane-bg:/);
    expect(css).toMatch(/\.cal-day\.today\s*\{\s*--lane-bg:/);
    expect(css).toMatch(/\.cal-day\.paced-short\s*\{\s*--lane-bg:/);
    expect(css).toMatch(/\.cal-day-col\s*\{[^}]*background-color:\s*var\(--lane-bg\)/);
  });
  test("lane keeps full rounding; sticky cutter re-rounds the visible bottom", async () => {
    const css = await Bun.file("site/static/style.css").text();
    const lane = css.match(/\.cal-day-col\s*\{[^}]*\}/);
    expect(lane).not.toBeNull();
    expect(lane![0]).toMatch(/border-radius:\s*var\(--md-sys-shape-corner-medium\)/);
    const cutter = css.match(/\.cal-day-col::after\s*\{[^}]*\}/);
    expect(cutter).not.toBeNull();
    expect(cutter![0]).toMatch(/position:\s*sticky/);
    expect(cutter![0]).toMatch(/bottom:\s*0/);
    expect(cutter![0]).toMatch(/margin-top:\s*auto/);
    expect(cutter![0]).toMatch(/pointer-events:\s*none/);
    expect(cutter![0]).toMatch(/mask:/);
  });
});

/** #853: the AM night band's top corners showed tiny dark notches — the
 *  translucent band lets the ::before top cutter's page-bg crescents read
 *  through it. The band's top corner zone (12px) now has an opaque lane-bg
 *  backing with the purple composited over it, so the corners render cleanly
 *  while the rest of the band stays translucent (hour lines show through).
 *  Plus cal-edge-top: entries starting at 00:00 touch the lane's top edge and
 *  paint above the z-0 cutter, so they get the lane's medium radius on their
 *  top corners — mirrors #851's cal-edge-bottom. */
describe("calendar top-edge rounding (#853)", () => {
  test("night band's top corner zone has an opaque lane-bg backing under the purple", async () => {
    const css = await Bun.file("site/static/style.css").text();
    const band = css.match(/\.cal-night-am\s*\{[^}]*\}/);
    expect(band).not.toBeNull();
    /* band keeps the lane's medium radius on its top corners … */
    expect(band![0]).toMatch(/border-radius:\s*var\(--md-sys-shape-corner-medium\)\s+var\(--md-sys-shape-corner-medium\)\s+0\s+0/);
    /* … and layers purple over an opaque lane-bg backing for exactly the
       top corner zone, with the translucent purple below it. */
    expect(band![0]).toMatch(/linear-gradient\(var\(--lane-bg\),\s*var\(--lane-bg\)\)\s+left top\s*\/\s*100%\s*var\(--md-sys-shape-corner-medium\)/);
  });
  test("cal-edge-top gives midnight-start entries the lane's medium top radius (compact pills excluded)", async () => {
    const css = await Bun.file("site/static/style.css").text();
    const rule = css.match(/\.cal-entry\.cal-edge-top:not\(\.cal-compact\)\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/border-top-left-radius:\s*var\(--md-sys-shape-corner-medium\)/);
    expect(rule![0]).toMatch(/border-top-right-radius:\s*var\(--md-sys-shape-corner-medium\)/);
  });

  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });
  /* 2026-09-21 is CDT (UTC-5): 05:00Z is local midnight. */
  const midnightEntry = {
    id: 31, description: "midnight start", project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T05:00:00.000Z", end_time: "2026-09-21T06:30:00.000Z",
  };
  const middayEntry = {
    id: 32, description: "midday", project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T15:00:00.000Z", end_time: "2026-09-21T16:00:00.000Z",
  };
  const compactMidnight = {
    id: 33, description: "compact midnight", project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T05:00:00.000Z", end_time: "2026-09-21T05:15:00.000Z",
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
  function classesFor(html: string, id: number): string {
    const m = html.match(new RegExp(`data-id="${id}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-id="${id}"`));
    if (!m) throw new Error(`no cal-entry with data-id=${id}`);
    return (m[1] ?? m[2] ?? "");
  }
  test("entry starting at 00:00 is flagged cal-edge-top; others are not", () => {
    const html = weekInnerHtml([midnightEntry, middayEntry, compactMidnight]);
    expect(classesFor(html, 31)).toContain("cal-edge-top");
    expect(classesFor(html, 32)).not.toContain("cal-edge-top");
    /* compact pills keep their 999px rounding — never flagged. */
    expect(classesFor(html, 33)).not.toContain("cal-edge-top");
    expect(classesFor(html, 33)).toContain("cal-compact");
  });
});

/** #857: a short entry starting near midnight got the 22px minimum-height
 *  floor with no room cap, so its card poked past the lane's bottom edge.
 *  Midnight now caps the floor (same shape as #279's next-entry cap), and
 *  the placeNow tick applies the same cap to running entries. */
describe("calendar midnight lane cap (#857)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 1 }),
    all: (..._a: unknown[]) => [],
  });
  /* 2026-09-21 is CDT (UTC-5): 04:50Z is 23:50 local. */
  const lateEntry = {
    id: 34, description: "almost midnight", project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-22T04:50:00.000Z", end_time: "2026-09-22T04:55:00.000Z",
  };
  const middayShortEntry = {
    id: 35, description: "midday short", project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null,
    invoice_number: null, invoice_status: null,
    start_time: "2026-09-21T15:00:00.000Z", end_time: "2026-09-21T15:05:00.000Z",
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
  function cardBox(html: string, id: number): { top: number; height: number; cls: string } {
    const m = html.match(new RegExp(`style="top:([0-9.]+)px;height:([0-9.]+)px[^"]*"[^>]*data-id="${id}"`));
    if (!m) throw new Error(`no cal-entry card with data-id=${id}`);
    const c = html.match(new RegExp(`class="([^"]*)"[^>]*data-id="${id}"`));
    return { top: parseFloat(m[1]), height: parseFloat(m[2]), cls: c ? c[1] : "" };
  }
  test("last entry of the day never extends past the lane bottom (24 * 64px)", () => {
    const html = weekInnerHtml([lateEntry]);
    const box = cardBox(html, 34);
    expect(box.top + box.height).toBeLessThanOrEqual(24 * 64);
    /* still compact — the floor treatment is capped, not removed. */
    expect(box.cls).toContain("cal-compact");
  });
  test("midday short entries still get the full 22px floor", () => {
    const html = weekInnerHtml([middayShortEntry]);
    const box = cardBox(html, 35);
    /* 22px floor minus the 4px #273 inset. */
    expect(box.height).toBeCloseTo(18, 0);
    expect(box.cls).toContain("cal-compact");
  });
  test("placeNow caps the running-entry floor at midnight", async () => {
    const src = await Bun.file("site/views/calendar.ts").text();
    const placeNow = src.slice(src.indexOf("function placeNow()"), src.indexOf("function syncCalHint()"));
    expect(placeNow).toContain("((1440-sm)/60)*HOUR");
  });
});

/** #946: on mobile, starting a scroll with the finger on a time entry opened
 *  the entry editor instead of scrolling — the pointerdown handler called
 *  openEdit immediately. The fix defers openEdit to pointerup behind a
 *  movement threshold, so a real scroll cancels the pending tap. */
describe("calendar entry tap-vs-scroll (#946)", () => {
  function downHandler(src: string) {
    return src.slice(
      src.indexOf("document.addEventListener('pointerdown'"),
      src.indexOf("/* #213: the server's clock")
    );
  }
  test("pointerdown no longer opens the editor immediately", async () => {
    const src = await Bun.file("site/views/calendar.ts").text();
    expect(downHandler(src)).not.toContain("if(entryEl){ openEdit(entryEl); return; }");
  });
  test("editor opens on pointerup only when the pointer barely moved", async () => {
    const src = await Bun.file("site/views/calendar.ts").text();
    const h = downHandler(src);
    expect(h).toContain("addEventListener('pointerup',tapUp)");
    expect(h).toContain("tapCancel(); openEdit(tapEl);");
    // drift past a small threshold cancels the pending tap
    expect(h).toMatch(/Math\.abs\(ev\.clientX-tapX\)>10/);
    expect(h).toMatch(/Math\.abs\(ev\.clientY-tapY\)>10/);
  });
  test("browser scroll takeover cancels the pending tap", async () => {
    const src = await Bun.file("site/views/calendar.ts").text();
    const h = downHandler(src);
    expect(h).toContain("addEventListener('pointercancel',tapCancel)");
  });
});

describe("mobile week-summary compaction (#945)", () => {
  test("narrow viewports get a compacted summary so the day list has room", async () => {
    const css = await Bun.file("site/static/style.css").text();
    const block = css.match(/@media\s*\(max-width:\s*839px\)\s*\{[^}]*\.cal-supporting[^}]*\}/);
    expect(block).not.toBeNull();
    expect(css).toMatch(/@media\s*\(max-width:\s*839px\)[\s\S]*?\.cal-supporting\s*\{[^}]*gap:\s*6px/);
    /* Hint stays visible but compact — never display:none. */
    expect(css).toMatch(/@media\s*\(max-width:\s*839px\)[\s\S]*?\.cal-supporting\s+\.cal-hint\s*\{[^}]*font-size:\s*0\.6875rem/);
    expect(css).not.toMatch(/\.cal-supporting\s+\.cal-hint\s*\{[^}]*display:\s*none/);
    /* CTA, progress, and clients legend are tightened. */
    expect(css).toMatch(/@media\s*\(max-width:\s*839px\)[\s\S]*?\.cal-supporting\s+\.nudge-chip\s*\{[^}]*padding:\s*4px 10px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*839px\)[\s\S]*?\.cal-supporting\s+\.week-clients\s*\{[^}]*gap:\s*4px 12px/);
  });
  test("agenda hint text is the short mobile version", async () => {
    const src = await Bun.file("site/views/calendar.ts").text();
    expect(src).toContain("Tap + to log time, tap an entry to edit.");
  });
});
