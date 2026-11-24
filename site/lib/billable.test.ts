/** #1082: billable flag. Non-billable time is tracked and counted as time,
 *  but never reaches a Zinvoice: unbilled selection, unbilled-by-client
 *  totals and entry linkability all skip it. Existing entries migrate to
 *  billable, so nothing about today's invoicing changes on upgrade. */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, createDbAt } from "../db.ts";
import { createDomain } from "./domain.ts";
import { billableFromForm, billableFromJson, entryLinkable } from "../routes/api.ts";
import { visualizer } from "../ui/visualizer.ts";

function setup() {
  const bundle = createDb(mkdtempSync(join(tmpdir(), "tk-billable-")));
  const { db } = bundle;
  db.query("INSERT INTO clients (id, name, rate) VALUES (1, 'Northwind', 50)").run();
  db.query("INSERT INTO projects (id, client_id, name) VALUES (1, 1, 'Site')").run();
  const ins = db.query("INSERT INTO time_entries (project_id, description, start_time, end_time, billable) VALUES (1, ?, ?, ?, ?)");
  ins.run("billed", "2026-10-05T09:00:00.000Z", "2026-10-05T10:00:00.000Z", 1);
  ins.run("courtesy", "2026-10-06T09:00:00.000Z", "2026-10-06T10:00:00.000Z", 0);
  const domain = createDomain({ db, qInvoice: bundle.qInvoice, qInvoiceItems: bundle.qInvoiceItems, TOKEN: "t" } as any);
  const idOf = (d: string) => (db.query("SELECT id FROM time_entries WHERE description = ?").get(d) as any).id;
  return { db, bundle, domain, idOf };
}

describe("billable flag (#1082)", () => {
  test("an existing database migrates with every entry billable", () => {
    const path = join(mkdtempSync(join(tmpdir(), "tk-billable-mig-")), "old.db");
    const old = new Database(path);
    old.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER,
      description TEXT NOT NULL DEFAULT '', start_time TEXT NOT NULL, end_time TEXT,
      created_at TEXT NOT NULL DEFAULT '')`);
    old.query("INSERT INTO time_entries (start_time, end_time) VALUES ('2026-01-01T09:00:00.000Z', '2026-01-01T10:00:00.000Z')").run();
    old.close();
    const { db } = createDbAt(path);
    expect(db.query("SELECT billable FROM time_entries").all()).toEqual([{ billable: 1 }]);
  });

  test("entries read through ENTRY_SELECT carry the flag", () => {
    const { bundle, idOf } = setup();
    expect((bundle.qOne.get(idOf("courtesy")) as any).billable).toBe(0);
    expect((bundle.qOne.get(idOf("billed")) as any).billable).toBe(1);
  });

  test("unbilledEntries (invoice preview and creation) skips non-billable time", () => {
    const { domain } = setup();
    expect(domain.unbilledEntries(1, "2026-10-01", "2026-10-31").map((e: any) => e.description)).toEqual(["billed"]);
  });

  test("unbilledByClient counts billable time only", () => {
    const { domain } = setup();
    expect(domain.unbilledByClient()).toEqual([{ id: 1, name: "Northwind", secs: 3600 }]);
  });

  test("clientRestFrom starts at the first billable entry", () => {
    const { db, domain } = setup();
    db.query("UPDATE time_entries SET start_time = '2026-10-01T09:00:00.000Z', end_time = '2026-10-01T10:00:00.000Z' WHERE description = 'courtesy'").run();
    expect(domain.clientRestFrom(1)).toBe("2026-10-05");
  });

  test("a non-billable entry can't be linked onto an invoice", () => {
    const { db, idOf } = setup();
    expect(entryLinkable(db, idOf("billed"), 1)).toBe(true);
    expect(entryLinkable(db, idOf("courtesy"), 1)).toBe(false);
  });
});

describe("billable form and JSON parsing (#1082)", () => {
  const form = (...vals: string[]) => { const f = new FormData(); for (const v of vals) f.append("billable", v); return f; };
  test("checked box wins over the hidden 0; hidden 0 alone is non-billable; absent keeps the fallback", () => {
    expect(billableFromForm(form("0", "1"), 0)).toBe(1);
    expect(billableFromForm(form("0"), 1)).toBe(0);
    expect(billableFromForm(form(), 0)).toBe(0);
    expect(billableFromForm(form(), 1)).toBe(1);
    expect(billableFromForm(form("on"), 0)).toBe(1);
  });
  test("JSON accepts booleans and 0/1, rejects anything else, keeps the fallback when absent", () => {
    expect(billableFromJson(true, 0)).toBe(1);
    expect(billableFromJson(false, 1)).toBe(0);
    expect(billableFromJson(0, 1)).toBe(0);
    expect(billableFromJson(undefined, 0)).toBe(0);
    expect(billableFromJson("yes", 1)).toBeNull();
  });
});

describe("visualizer non-billable block (#1082)", () => {
  const html = (nonBillable: boolean) => visualizer({ days: [{ date: "2026-10-05", label: "Mon", total: "1h", entries: [
    { id: "1", title: "Courtesy fix", startMin: 540, endMin: 600, nonBillable },
  ] }] });
  test("a non-billable block is marked for style, for the dialog, and for screen readers", () => {
    const h = html(true);
    expect(h).toContain("is-nonbillable");
    expect(h).toContain('data-billable="0"');
    expect(h).toContain(", non-billable");
  });
  test("a billable block carries none of it", () => {
    const h = html(false);
    expect(h).not.toContain("is-nonbillable");
    expect(h).not.toContain("data-billable");
  });
});
