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
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL, billable INTEGER NOT NULL DEFAULT 1, tz TEXT,
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

/** #992: unbilledByClient aggregates in SQL. The per-entry math must match
 *  the old JS loop exactly: durationSeconds (ms diff rounded to the nearest
 *  second, clamped at 0) then roundUpSeconds (up to the 5-minute increment,
 *  per entry, before summing). */
describe("unbilledByClient SQL aggregation (#992)", () => {
  function setupUbc() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#fb923c', rate REAL NOT NULL DEFAULT 0, payment_terms TEXT);
      CREATE TABLE projects (id INTEGER PRIMARY KEY, client_id INTEGER, name TEXT NOT NULL);
      CREATE TABLE time_entries (id INTEGER PRIMARY KEY, project_id INTEGER,
        description TEXT NOT NULL DEFAULT '', start_time TEXT NOT NULL, end_time TEXT,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL, billable INTEGER NOT NULL DEFAULT 1, tz TEXT,
        created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE invoices (id INTEGER PRIMARY KEY);`);
    db.query("INSERT INTO clients (id, name, rate) VALUES (1, 'Beta', 40), (2, 'Alpha', 50), (3, 'Zero', 10)").run();
    db.query("INSERT INTO projects (id, client_id, name) VALUES (1, 1, 'B1'), (2, 1, 'B2'), (3, 2, 'A1'), (4, 3, 'Z1'), (5, NULL, 'Orphan')").run();
    const ins = db.query(
      "INSERT INTO time_entries (project_id, description, start_time, end_time, invoice_id) VALUES (?, ?, ?, ?, ?)");
    const add = (pid: number, start: string, end: string | null, inv: number | null = null) =>
      ins.run(pid, "", start, end, inv);
    return { db, add, domain: createDomain({ db, qInvoice: null, qInvoiceItems: null, TOKEN: "t" } as any) };
  }

  test("sums per client with the 5-minute round-up applied per entry, ordered by name", () => {
    const { add, domain } = setupUbc();
    add(1, "2026-09-14T09:00:00.000Z", "2026-09-14T09:01:01.000Z"); // 61s -> 300
    add(2, "2026-09-14T10:00:00.000Z", "2026-09-14T10:05:00.000Z"); // exact 300 stays 300, second project
    add(3, "2026-09-14T09:00:00.000Z", "2026-09-14T10:00:00.000Z"); // 3600
    expect(domain.unbilledByClient()).toEqual([
      { id: 2, name: "Alpha", secs: 3600 },
      { id: 1, name: "Beta", secs: 600 },
    ]);
  });

  test("round-up is per entry, not per client (61s + 61s bills 600, not 300)", () => {
    const { add, domain } = setupUbc();
    add(3, "2026-09-14T09:00:00.000Z", "2026-09-14T09:01:01.000Z");
    add(3, "2026-09-14T10:00:00.000Z", "2026-09-14T10:01:01.000Z");
    expect(domain.unbilledByClient()).toEqual([{ id: 2, name: "Alpha", secs: 600 }]);
  });

  test("300.5s rounds to 301s and bills 600 (a floor of the duration would bill 300)", () => {
    const { add, domain } = setupUbc();
    add(3, "2026-09-14T09:00:00.000Z", "2026-09-14T09:05:00.500Z");
    expect(domain.unbilledByClient()).toEqual([{ id: 2, name: "Alpha", secs: 600 }]);
  });

  test("rounds the duration to the nearest second before the round-up (300.4s counts as 300s, not 600s)", () => {
    const { add, domain } = setupUbc();
    add(3, "2026-09-14T09:00:00.000Z", "2026-09-14T09:05:00.400Z");
    expect(domain.unbilledByClient()).toEqual([{ id: 2, name: "Alpha", secs: 300 }]);
  });

  test("a .5s remainder rounds the second up, matching Math.round", () => {
    const { add, domain } = setupUbc();
    add(3, "2026-09-14T09:00:00.000Z", "2026-09-14T09:09:59.500Z"); // 599.5s -> 600s -> 600
    expect(domain.unbilledByClient()).toEqual([{ id: 2, name: "Alpha", secs: 600 }]);
  });

  test("zero and negative durations contribute nothing; a client with only those is absent", () => {
    const { add, domain } = setupUbc();
    add(4, "2026-09-14T09:00:00.000Z", "2026-09-14T09:00:00.000Z");
    add(4, "2026-09-14T10:00:00.000Z", "2026-09-14T09:00:00.000Z");
    expect(domain.unbilledByClient()).toEqual([]);
  });

  test("invoiced and still-running entries are excluded, as are entries on client-less projects", () => {
    const { add, domain } = setupUbc();
    add(3, "2026-09-14T09:00:00.000Z", "2026-09-14T10:00:00.000Z", 7);
    add(3, "2026-09-14T11:00:00.000Z", null);
    add(5, "2026-09-14T09:00:00.000Z", "2026-09-14T10:00:00.000Z");
    expect(domain.unbilledByClient()).toEqual([]);
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
