/** #598: the invoice date range is inclusive of the end date.
 *
 *  unbilledEntries used to pull [from, to) — entries starting on the to-date
 *  never made it onto the invoice, silently dropping the end day's hours.
 *  The range is now [from, to]: the to-date's entries count, the day after
 *  still doesn't.
 */
import { describe, expect, test } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDomain, dayTargetSecs, DAY_TARGET_SECS } from "./domain.ts";
import { createDb, getMeta, setMeta } from "../db.ts";

function setup() {
  const db = new BunDatabase(":memory:");
  db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#fb923c', rate REAL NOT NULL DEFAULT 0, payment_terms TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, client_id INTEGER, name TEXT NOT NULL);
    CREATE TABLE time_entries (id INTEGER PRIMARY KEY, project_id INTEGER,
      description TEXT NOT NULL DEFAULT '', start_time TEXT NOT NULL, end_time TEXT,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE invoices (id INTEGER PRIMARY KEY);`);
  db.query("INSERT INTO clients (id, name, rate) VALUES (1, 'Gpb', 40)").run();
  db.query("INSERT INTO projects (id, client_id, name) VALUES (1, 1, 'Site')").run();
  const ins = db.query(
    "INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (1, ?, ?, ?)");
  ins.run("start day", "2026-09-14T09:00:00", "2026-09-14T17:00:00");
  ins.run("end day", "2026-09-24T09:00:00", "2026-09-24T17:00:00");
  ins.run("day after", "2026-09-25T09:00:00", "2026-09-25T17:00:00");
  const { unbilledEntries } = createDomain({
    db, qInvoice: null, qInvoiceItems: null, TOKEN: "t",
  } as any);
  return { unbilledEntries };
}

describe("unbilledEntries end-date inclusivity", () => {
  test("entries on the to-date are included, entries the day after are not", () => {
    const { unbilledEntries } = setup();
    const rows = unbilledEntries(1, "2026-09-14T00:00:00", "2026-09-24T00:00:00");
    expect(rows.map((r: any) => r.description)).toEqual(["start day", "end day"]);
  });

  test("works with plain YYYY-MM-DD strings (API path)", () => {
    const { unbilledEntries } = setup();
    const rows = unbilledEntries(1, "2026-09-14", "2026-09-24");
    expect(rows.map((r: any) => r.description)).toEqual(["start day", "end day"]);
  });
});

/** #908: configurable daily hours target (meta-backed, no migration). */
describe("dayTargetSecs", () => {
  const setup = () => createDb(mkdtempSync(join(tmpdir(), "tk-target-"))).db;

  test("defaults to 8h when unset", () => {
    expect(dayTargetSecs(setup())).toBe(8 * 3600);
  });

  test("reads the stored setting", () => {
    const db = setup();
    setMeta(db, "day_target_hours", "6");
    expect(dayTargetSecs(db)).toBe(6 * 3600);
    expect(getMeta(db, "day_target_hours")).toBe("6");
  });

  test("accepts halves", () => {
    const db = setup();
    setMeta(db, "day_target_hours", "6.5");
    expect(dayTargetSecs(db)).toBe(Math.round(6.5 * 3600));
  });

  test("falls back to 8h on missing, non-numeric, or out-of-range values", () => {
    for (const v of ["", "abc", "0", "99", "-3", "NaN", "Infinity"]) {
      const db = setup();
      setMeta(db, "day_target_hours", v);
      expect(dayTargetSecs(db)).toBe(DAY_TARGET_SECS);
    }
  });
});

describe("weekTargetBar follows the daily target", () => {
  test("week target is five days at the user's daily target", () => {
    const db = createDb(mkdtempSync(join(tmpdir(), "tk-target-"))).db;
    setMeta(db, "day_target_hours", "6");
    const { weekTargetBar } = createDomain({ db, qInvoice: null, qInvoiceItems: null, TOKEN: "t" } as any);
    const html = weekTargetBar(0);
    expect(html).toContain("/ 30h");
    expect(html).toContain("Weekly hours target, 30 hours");
  });

  test("default week bar is still 40h", () => {
    const db = createDb(mkdtempSync(join(tmpdir(), "tk-target-"))).db;
    const { weekTargetBar } = createDomain({ db, qInvoice: null, qInvoiceItems: null, TOKEN: "t" } as any);
    const html = weekTargetBar(0);
    expect(html).toContain("/ 40h");
  });
});
