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
