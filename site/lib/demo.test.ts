/** #492: seeded demo invoices must carry item date ranges — NULL dates left
 *  the invoice sheet's Date column rendering empty cells on every first-run
 *  demo invoice. */
/** #763: the seeded paid demo invoice must carry paid_at — the real
 *  mark-paid flow always sets it, and the detail actions row only renders
 *  the paid chip when it exists. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import { seedDemoData, demoIds } from "./demo.ts";
import { shortDateRange } from "./format.ts";

describe("demo paid invoice paid_at (#763)", () => {
  test("DEMO-001 (paid) has a paid_at date like the mark-paid flow sets", () => {
    const db = seededDb();
    const row = db.query("SELECT status, paid_at FROM invoices WHERE number = 'DEMO-001'").get() as any;
    expect(row.status).toBe("paid");
    expect(row.paid_at).toBeTruthy();
    expect(/^\d{4}-\d{2}-\d{2}$/.test(row.paid_at)).toBe(true);
  });
  test("unpaid demo invoices keep paid_at NULL", () => {
    const db = seededDb();
    const rows = db.query("SELECT number, paid_at FROM invoices WHERE status != 'paid'").all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.paid_at).toBeNull();
  });
});

function seededDb() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-demo-"))).db;
  seedDemoData(db);
  return db;
}

describe("demo invoice dates (#492)", () => {
  test("every demo invoice item has a date range that renders", () => {
    const db = seededDb();
    const items = db.query("SELECT date_from, date_to FROM invoice_items").all() as any[];
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.date_from).toBeTruthy();
      /* shortDateRange is what the invoice sheet renders into the Date cell */
      expect(shortDateRange(it.date_from, it.date_to)).not.toBe("");
    }
  });
  test("item dates are ordered and not after their invoice's issue date", () => {
    const db = seededDb();
    const rows = db.query(
      "SELECT i.issue_date, ii.date_from, ii.date_to FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id"
    ).all() as any[];
    for (const r of rows) {
      expect(r.date_from <= (r.date_to || r.date_from)).toBe(true);
      expect((r.date_to || r.date_from) <= r.issue_date).toBe(true);
    }
  });
  test("demo ids still round-trip for reset", () => {
    const db = seededDb();
    const ids = demoIds(db);
    expect(ids.invoices.length).toBe(3);
  });
});
