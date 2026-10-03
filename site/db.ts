/** Database layer: SQLite init, schema, idempotent migrations, demo seeding,
 *  and the shared prepared queries. Everything is created inside createDb()
 *  so server.ts owns DATA_DIR and passes it in; the returned bundle keeps all
 *  existing call sites (db, qRunning, seedDemoData, ...) working unchanged.
 *  Demo seeding/banner will move to lib/demo.ts in a later slice (#167). */

import { Database } from "bun:sqlite";
import { join } from "node:path";

/* #745: file-addressed variant — the schema/migration body lives here so
   hosted tenants can live at DATA_DIR/<user_id>.db instead of a directory. */
export function createDb(dataDir: string) {
  return createDbAt(join(dataDir, "timekeep.db"));
}

export function createDbAt(dbPath: string) {
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  /* NOTE: the ON DELETE actions declared below are NOT enforced by SQLite
     (no PRAGMA foreign_keys). Delete routes null out / clean up referencing
     rows explicitly — see the client/project/invoice delete handlers. */
  db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#f2c14e'
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL,
  end_time TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_start ON time_entries(start_time);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  tax_rate REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  hours REAL NOT NULL,
  rate REAL NOT NULL,
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);
`);
/* Issue #243: per-line dates for best-practice invoice line items
   (Date | Description | Hours | Rate | Amount). Nullable so existing
   rows degrade gracefully. */
for (const col of ["date_from", "date_to"]) {
  try { db.exec(`ALTER TABLE invoice_items ADD COLUMN ${col} TEXT`); }
  catch { /* column already exists */ }
}
/* Issue #197: estimates removed — drop the orphaned tables so
   existing databases are cleaned up. */
db.exec(`DROP TABLE IF EXISTS estimate_items; DROP TABLE IF EXISTS estimates;`);
/* Issue #199: per-client rounding removed in favor of a fixed 5-minute rule —
   drop the orphaned column so existing databases are cleaned up. */
try { db.exec("ALTER TABLE clients DROP COLUMN rounding_minutes"); }
catch { /* column already gone */ }
/* Issue #201: project budgets removed — drop the orphaned columns so
   existing databases are cleaned up. */
try { db.exec("ALTER TABLE projects DROP COLUMN budget_hours"); }
catch { /* column already gone */ }
try { db.exec("ALTER TABLE projects DROP COLUMN budget_amount"); }
catch { /* column already gone */ }
/* Issue #195: recurring invoices removed — drop the orphaned table so
   existing databases are cleaned up. */
db.exec(`DROP TABLE IF EXISTS recurring_schedules;`);
  /* Milestone 11: meta table backing demo onboarding (see lib/demo.ts). */
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);


  /* idempotent column additions for DBs created before invoicing landed */
  for (const [tbl, col, def] of [
    ["clients", "rate", "REAL NOT NULL DEFAULT 0"],
    /* Issue #289: per-client payment terms (nullable — blank falls back to
       the global business_payment_terms meta). */
    ["clients", "payment_terms", "TEXT"],
    /* Issue #627: client contact details — email, phone, website, address
       (multi-line). Nullable; blank fields store NULL. */
    ["clients", "email", "TEXT"],
    ["clients", "phone", "TEXT"],
    ["clients", "website", "TEXT"],
    ["clients", "address", "TEXT"],
    ["time_entries", "invoice_id", "INTEGER REFERENCES invoices(id) ON DELETE SET NULL"],
    ["invoices", "template", "TEXT NOT NULL DEFAULT 'classic'"],
    ["invoices", "stripe_payment_link", "TEXT"],
    /* Issue #645: payment-link ID (plink_...) for webhook matching — Stripe
       does not propagate payment-link metadata to checkout sessions, so the
       webhook matches session.payment_link against this instead. */
    ["invoices", "stripe_payment_link_id", "TEXT"],
    ["invoices", "paid_via_stripe", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "public_token", "TEXT"],
    ["invoices", "paid_at", "TEXT"],
    /* Issue #302: internal-only invoice notes — never rendered on the PDF,
       HTML sheet, or public /i/ page. */
    ["invoices", "internal_notes", "TEXT NOT NULL DEFAULT ''"],
    /* Issue #301: immutable invoices — rendered output frozen at send time
       (re-frozen at the paid milestone for the status badge). Served verbatim
       afterwards, so re-downloads are byte-identical. */
    ["invoices", "pdf_snapshot", "BLOB"],
    ["invoices", "html_snapshot", "TEXT"],
  ] as const) {
    try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); }
    catch { /* column already exists */ }
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token)");
  /* Issue #293: payment terms become a fixed option list. Migrate existing
     free-text values to enum keys. Idempotent — reruns only touch values
     that still aren't keys. */
  {
    const valid = ["due_on_receipt", "net_7", "net_15", "net_30", "net_45", "net_60", "pay_when_paid"];
    const toKey = (v: string): string => {
      const t = v.trim();
      if (valid.includes(t)) return t;
      if (/pay.when.paid/i.test(t)) return "pay_when_paid";
      const m = /^(\d+)$/.exec(t);
      if (m && valid.includes("net_" + m[1])) return "net_" + m[1];
      return "net_30";
    };
    for (const row of db.query("SELECT id, payment_terms FROM clients WHERE payment_terms IS NOT NULL").all() as { id: number; payment_terms: string }[]) {
      const k = toKey(row.payment_terms);
      if (k !== row.payment_terms) db.query("UPDATE clients SET payment_terms = ? WHERE id = ?").run(k, row.id);
    }
    const g = getMeta(db, "business_payment_terms");
    if (!g) setMeta(db, "business_payment_terms", "net_30");
    else if (!valid.includes(g.trim())) setMeta(db, "business_payment_terms", toKey(g));
  }
  /* Issue #203: client portal removed — drop the orphaned token column/index. */
  db.exec("DROP INDEX IF EXISTS idx_clients_portal_token");
  try { db.exec("ALTER TABLE clients DROP COLUMN portal_token"); }
  catch { /* column already gone */ }

  const ENTRY_SELECT = `
  SELECT e.id, e.project_id, e.description, e.start_time, e.end_time, e.invoice_id,
         p.name AS project_name, c.name AS client_name, c.color AS client_color,
         i.number AS invoice_number, i.status AS invoice_status
  FROM time_entries e
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN invoices i ON i.id = e.invoice_id`;

  const qRunning = db.query(`${ENTRY_SELECT} WHERE e.end_time IS NULL ORDER BY e.start_time DESC LIMIT 1`);
  const qOne = db.query(`${ENTRY_SELECT} WHERE e.id = ?`);
  const qRange = db.query(`${ENTRY_SELECT} WHERE e.start_time >= ? AND e.start_time < ? ORDER BY e.start_time DESC`);

  const qInvoice = db.query(
    `SELECT i.*, c.name AS client_name, c.color AS client_color,
            c.payment_terms AS client_payment_terms,
            c.email AS client_email, c.phone AS client_phone,
            c.website AS client_website, c.address AS client_address
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`);
  const qInvoiceItems = db.query("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id");
  const qInvoices = db.query(
    `SELECT i.*, c.name AS client_name, c.color AS client_color,
          c.payment_terms AS client_payment_terms,
          COALESCE((SELECT SUM(amount) FROM invoice_items WHERE invoice_id = i.id), 0) AS subtotal
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.issue_date DESC, i.id DESC`);

  const qRevenueRows = db.query(
    `SELECT i.id, i.number, i.due_date, i.status, i.tax_rate, i.issue_date, i.client_id,
          c.name AS client_name, c.color AS client_color,
          c.payment_terms AS client_payment_terms,
          COALESCE((SELECT SUM(amount) FROM invoice_items WHERE invoice_id = i.id), 0) AS subtotal
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id`);

  return {
    db,
    ENTRY_SELECT,
    qRunning, qOne, qRange, qInvoice, qInvoiceItems, qInvoices, qRevenueRows,
  };
}

export type DbBundle = ReturnType<typeof createDb>;

/* #233: tiny key/value helpers over the meta table (business profile, etc.). */
export function getMeta(db: Database, key: string): string {
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? "";
}

export function setMeta(db: Database, key: string, value: string): void {
  db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
