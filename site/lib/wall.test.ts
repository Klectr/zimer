/** #1081: wall-clock time. 8–5 worked in California shows 8–5 and lands on
 *  the day it was worked, whatever zone you view it from. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import { createDomain } from "./domain.ts";
import { createCalendarViews } from "../views/calendar.ts";
import { createTimerViews } from "../views/timer.ts";
import { bareWallToIso, entryDay, onWallDays, validTz, wallDayParam, wallParts, wallToIso } from "./wall.ts";

describe("wall-time helpers", () => {
  test("a wall time resolves with the offset of its own date, across DST", () => {
    expect(wallToIso("2026-07-15", "08:00", "America/Chicago")).toBe("2026-07-15T13:00:00.000Z"); /* CDT */
    expect(wallToIso("2026-11-24", "08:00", "America/Chicago")).toBe("2026-11-24T14:00:00.000Z"); /* CST */
    expect(wallToIso("2026-11-24", "08:00", "America/Los_Angeles")).toBe("2026-11-24T16:00:00.000Z");
    expect(wallToIso("2026-11-24", "08:00", "UTC")).toBe("2026-11-24T08:00:00.000Z");
  });

  test("bare datetime-local values parse; offsets and impossible dates don't", () => {
    expect(bareWallToIso("2026-11-24T08:00", "America/New_York")).toBe("2026-11-24T13:00:00.000Z");
    expect(bareWallToIso("2026-02-30T08:00", "America/New_York")).toBeNull();
    expect(bareWallToIso("2026-11-24T08:00-05:00", "America/New_York")).toBeNull();
    expect(bareWallToIso("garbage", "America/New_York")).toBeNull();
  });

  test("wall times a zone offset pushes past the 4-digit year are null (#1532)", () => {
    expect(bareWallToIso("9999-12-31T23:00", "America/New_York")).toBeNull();
    expect(bareWallToIso("0000-01-01T00:30", "Pacific/Auckland")).toBeNull();
    expect(bareWallToIso("9999-12-31T00:00", "UTC")).toBe("9999-12-31T00:00:00.000Z");
  });

  test("zone names are validated", () => {
    expect(validTz("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(validTz("UTC")).toBe("UTC");
    expect(validTz("Not/AZone")).toBeNull();
    expect(validTz("x; DROP TABLE")).toBeNull();
    expect(validTz(42)).toBeNull();
  });

  test("zone validation answers are stable across repeated calls (#1518)", () => {
    for (let i = 0; i < 3; i++) {
      expect(validTz("America/Chicago")).toBe("America/Chicago");
      expect(validTz("UTC")).toBe("UTC");
      expect(validTz("Not/AZone")).toBeNull();
    }
    for (let i = 0; i < 300; i++) expect(validTz(`Bogus/Zone${i}`)).toBeNull();
    expect(validTz("America/Chicago")).toBe("America/Chicago");
    expect(validTz("Bogus/Zone0")).toBeNull();
  });

  test("an entry's day and clock are its own zone's; legacy rows use the viewer's", () => {
    const la = { start_time: "2026-11-24T16:00:00.000Z", tz: "America/Los_Angeles" }; /* 8am LA, 11am NY */
    expect(entryDay(la, "America/New_York")).toBe("2026-11-24");
    expect(wallParts(la.start_time, la.tz).hh).toBe(8);
    const lateLa = { start_time: "2026-11-25T06:30:00.000Z", tz: "America/Los_Angeles" }; /* 10:30pm LA Nov 24 = 1:30am NY Nov 25 */
    expect(entryDay(lateLa, "America/New_York")).toBe("2026-11-24");
    const legacy = { start_time: "2026-11-25T06:30:00.000Z", tz: null };
    expect(entryDay(legacy, "America/New_York")).toBe("2026-11-25");
    expect(onWallDays([lateLa, legacy], "2026-11-24", "2026-11-25", "America/New_York")).toEqual([lateLa]);
  });

  test("?day=&tz= parses only a real day with a real zone", () => {
    expect(wallDayParam("2026-11-24", "America/Chicago")).toEqual({ day: "2026-11-24", tz: "America/Chicago" });
    expect(wallDayParam("2026-02-30", "America/Chicago")).toBeNull();
    expect(wallDayParam("2026-11-24", "Nope/Nope")).toBeNull();
    expect(wallDayParam(null, null)).toBeNull();
  });
});

function setup() {
  const bundle = createDb(mkdtempSync(join(tmpdir(), "tk-wall-")));
  const { db } = bundle;
  db.query("INSERT INTO clients (id, name, rate) VALUES (1, 'Northwind', 100)").run();
  db.query("INSERT INTO projects (id, client_id, name) VALUES (1, 1, 'Site')").run();
  const add = (start: string, end: string | null, tz: string | null, desc = "work") =>
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time, tz) VALUES (1, ?, ?, ?, ?)").run(desc, start, end, tz);
  return { bundle, db, add };
}

describe("the travel case on the calendar (#1081)", () => {
  function calendar(bundle: ReturnType<typeof createDb>) {
    return createCalendarViews({
      db: bundle.db, qOne: bundle.qOne, qRange: bundle.qRange, entrySelect: bundle.ENTRY_SELECT,
      layout: (_t: string, b: string) => b, projectOptionRows: () => [], weekTargetBar: () => "", calHourPx: 64,
    } as any);
  }
  const block = (html: string, desc: string) =>
    html.match(new RegExp(`<div class="ui-viz-block[^"]*"[^>]*aria-label="Site — ${desc}[^"]*"[^>]*>`))?.[0] ?? "";

  test("8–5 logged in California renders 8–5 viewed from New York", () => {
    const { bundle, add } = setup();
    add("2026-09-22T15:00:00.000Z", "2026-09-23T00:00:00.000Z", "America/Los_Angeles", "california"); /* 8am–5pm PDT */
    const html = calendar(bundle).weekStrip("2026-09-20", "America/New_York");
    const b = block(html, "california");
    expect(b).toContain('data-date="2026-09-22"');
    expect(b).toContain('data-start="08:00"');
    expect(b).toContain('data-end="17:00"');
    expect(b).toContain('data-tz="America/Los_Angeles"');
  });

  test("8–5 in California and 8–5 in Florida both read 8–5, side by side", () => {
    const { bundle, add } = setup();
    add("2026-09-21T15:00:00.000Z", "2026-09-22T00:00:00.000Z", "America/Los_Angeles", "monday ca");
    add("2026-09-22T12:00:00.000Z", "2026-09-22T21:00:00.000Z", "America/New_York", "tuesday fl");
    for (const viewer of ["America/Los_Angeles", "America/New_York", "Europe/London"]) {
      const html = calendar(bundle).weekStrip("2026-09-20", viewer);
      expect(block(html, "monday ca")).toContain('data-start="08:00"');
      expect(block(html, "tuesday fl")).toContain('data-start="08:00"');
      expect(block(html, "tuesday fl")).toContain('data-end="17:00"');
    }
  });

  test("late Saturday in California stays in its week when viewed from New York", () => {
    const { bundle, add } = setup();
    /* Sat Sep 26 10:30pm PDT = Sun Sep 27 1:30am EDT — the next week in New York. */
    add("2026-09-27T05:30:00.000Z", "2026-09-27T06:00:00.000Z", "America/Los_Angeles", "late saturday");
    const cal = calendar(bundle);
    const thisWeek = cal.weekStrip("2026-09-20", "America/New_York");
    expect(block(thisWeek, "late saturday")).toContain('data-date="2026-09-26"');
    expect(block(thisWeek, "late saturday")).toContain('data-start="22:30"');
    expect(block(cal.weekStrip("2026-09-27", "America/New_York"), "late saturday")).toBe("");
  });
});

describe("timer page today, by wall day (#1081)", () => {
  test("today's list is the entries worked today in their own zone, shown in that zone", () => {
    const { bundle, db, add } = setup();
    add("2026-11-24T16:00:00.000Z", "2026-11-25T01:00:00.000Z", "America/Los_Angeles", "ca today"); /* Nov 24 8–5 PST */
    add("2026-11-25T06:30:00.000Z", "2026-11-25T07:00:00.000Z", "America/Los_Angeles", "ca late");  /* Nov 24 10:30pm PST */
    add("2026-11-23T16:00:00.000Z", "2026-11-23T17:00:00.000Z", "America/Los_Angeles", "ca yesterday");
    const timer = createTimerViews({
      db, qRunning: bundle.qRunning, qRange: bundle.qRange, layout: (_t: string, b: string) => b,
      demoBanner: () => "", projectOptions: () => "", projectOptionRows: () => [], dayTargetSecs: () => 8 * 3600,
    } as any);
    const html = timer.todayPartial(undefined, undefined, { day: "2026-11-24", tz: "America/New_York" });
    expect(html).toContain("ca today");
    expect(html).toContain("ca late");
    expect(html).not.toContain("ca yesterday");
    expect(html).toContain('data-tz="America/Los_Angeles"');
  });
});

describe("invoicing by wall day (#1081)", () => {
  test("a range includes the time worked on its days in the entry's own zone", () => {
    const { bundle, db, add } = setup();
    /* Sep 30 8pm PDT is Oct 1 03:00 UTC — it was worked in September. */
    add("2026-10-01T03:00:00.000Z", "2026-10-01T04:00:00.000Z", "America/Los_Angeles", "sep 30 evening");
    add("2026-10-01T15:00:00.000Z", "2026-10-01T16:00:00.000Z", "America/Los_Angeles", "oct 1 morning");
    const domain = createDomain({ db, qInvoice: bundle.qInvoice, qInvoiceItems: bundle.qInvoiceItems, TOKEN: "t" } as any);
    const sept = domain.unbilledEntries(1, "2026-09-01", "2026-09-30");
    expect(sept.map((e: any) => e.description)).toEqual(["sep 30 evening"]);
    expect(domain.groupToLineItems(sept, 100)[0]).toMatchObject({ date_from: "2026-09-30", date_to: "2026-09-30" });
    expect(domain.clientUnbilledSpan(1)).toEqual({ first: "2026-09-30", last: "2026-10-01" });
  });

  test("legacy entries with no zone keep their UTC day", () => {
    const { bundle, db, add } = setup();
    add("2026-10-01T03:00:00.000Z", "2026-10-01T04:00:00.000Z", null, "legacy");
    const domain = createDomain({ db, qInvoice: bundle.qInvoice, qInvoiceItems: bundle.qInvoiceItems, TOKEN: "t" } as any);
    expect(domain.unbilledEntries(1, "2026-09-01", "2026-09-30")).toEqual([]);
    expect(domain.unbilledEntries(1, "2026-10-01", "2026-10-31").length).toBe(1);
  });
});
