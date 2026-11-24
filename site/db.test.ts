import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, createDbAt } from "./db.ts";

function seededBundle() {
  const bundle = createDb(mkdtempSync(join(tmpdir(), "tk-db-")));
  const { db } = bundle;
  db.query("INSERT INTO clients (id, name, payment_terms) VALUES (1, 'Acme', 'net_15')").run();
  db.query(
    `INSERT INTO invoices (id, client_id, number, issue_date, due_date, status, tax_rate, notes,
       internal_notes, html_snapshot, pdf_snapshot, public_token, stripe_payment_link, paid_at, period_from, period_to)
     VALUES (1, 1, 'INV-0001', '2026-11-01', '2026-11-16', 'paid', 10, 'client note',
       'internal secret', '<html>frozen</html>', X'25504446', 'tok_secret', 'https://pay.example/x', '2026-11-10', '2026-10-19', '2026-10-30')`
  ).run();
  db.query("INSERT INTO invoice_items (invoice_id, description, hours, rate, amount) VALUES (1, 'Work', 2, 50, 100)").run();
  return bundle;
}

describe("invoice list query (#1293, slice of #992)", () => {
  test("list rows carry the columns list + API consumers read, with the item subtotal", () => {
    const { qInvoices } = seededBundle();
    const rows = qInvoices.all() as any[];
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.id).toBe(1);
    expect(r.client_id).toBe(1);
    expect(r.number).toBe("INV-0001");
    expect(r.issue_date).toBe("2026-11-01");
    expect(r.due_date).toBe("2026-11-16");
    expect(r.status).toBe("paid");
    expect(r.tax_rate).toBe(10);
    expect(r.paid_at).toBe("2026-11-10");
    expect(r.period_from).toBe("2026-10-19");
    expect(r.period_to).toBe("2026-10-30");
    expect(r.client_name).toBe("Acme");
    expect(r.client_payment_terms).toBe("net_15");
    expect("client_color" in r).toBe(true);
    expect("project_name" in r).toBe(true);
    expect(r.subtotal).toBe(100);
  });

  test("list rows do not load snapshots, internal notes, or tokens", () => {
    const { qInvoices } = seededBundle();
    const r = qInvoices.all()[0] as any;
    for (const col of ["html_snapshot", "pdf_snapshot", "internal_notes", "notes", "public_token", "stripe_payment_link", "stripe_payment_link_id", "paid_via_stripe", "template", "created_at"])
      expect(col in r).toBe(false);
  });

  test("the single-invoice query stays full-width for the detail view", () => {
    const { qInvoice } = seededBundle();
    const inv = qInvoice.get(1) as any;
    expect(inv.html_snapshot).toBe("<html>frozen</html>");
    expect(inv.internal_notes).toBe("internal secret");
    expect(inv.public_token).toBe("tok_secret");
    expect(inv.notes).toBe("client note");
    expect(inv.template).toBe("classic");
    expect(inv.stripe_payment_link).toBe("https://pay.example/x");
    expect(inv.pdf_snapshot).not.toBeNull();
  });
});

describe("sqlite busy timeout (#1319, slice of #996)", () => {
  test("tenant DB is created with a 5000ms busy timeout", () => {
    const { db } = createDb(mkdtempSync(join(tmpdir(), "tk-db-")));
    const row = db.query("PRAGMA busy_timeout").get() as { timeout: number };
    expect(row.timeout).toBe(5000);
  });
});

describe("sqlite pragma profile (#996)", () => {
  test("tenant DB uses NORMAL sync, an 8000 KiB cache, and in-memory temp storage", () => {
    const { db } = createDb(mkdtempSync(join(tmpdir(), "tk-db-")));
    const sync = db.query("PRAGMA synchronous").get() as { synchronous: number };
    expect(sync.synchronous).toBe(1);
    const cache = db.query("PRAGMA cache_size").get() as { cache_size: number };
    expect(cache.cache_size).toBe(-8000);
    const temp = db.query("PRAGMA temp_store").get() as { temp_store: number };
    expect(temp.temp_store).toBe(2);
  });

  test("createDbAt (the hosted tenant path) carries the same profile", () => {
    const { db } = createDbAt(join(mkdtempSync(join(tmpdir(), "tk-db-")), "tenant.db"));
    const sync = db.query("PRAGMA synchronous").get() as { synchronous: number };
    expect(sync.synchronous).toBe(1);
    const cache = db.query("PRAGMA cache_size").get() as { cache_size: number };
    expect(cache.cache_size).toBe(-8000);
    const temp = db.query("PRAGMA temp_store").get() as { temp_store: number };
    expect(temp.temp_store).toBe(2);
  });
});
