/** Database layer: SQLite init, schema, idempotent migrations, demo seeding,
 *  and the shared prepared queries. Everything is created inside createDb()
 *  so server.ts owns DATA_DIR and passes it in; the returned bundle keeps all
 *  existing call sites (db, qRunning, seedDemoData, ...) working unchanged.
 *  Demo seeding/banner will move to lib/demo.ts in a later slice (#167). */

import { Database } from "bun:sqlite";
import { join } from "node:path";

export function createDb(dataDir: string) {
  const db = new Database(join(dataDir, "timekeep.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
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
/* Milestone 13: estimates/quotes that convert to draft invoices. */
CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  issue_date TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  converted_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS estimate_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  hours REAL NOT NULL,
  rate REAL NOT NULL,
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_est_items ON estimate_items(estimate_id);
`);
/* Issue #195: recurring invoices removed — drop the orphaned table so
   existing databases are cleaned up. */
db.exec(`DROP TABLE IF EXISTS recurring_schedules;`);
  /* Milestone 11: meta table backing demo onboarding (see lib/demo.ts). */
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);


  /* idempotent column additions for DBs created before invoicing landed */
  for (const [tbl, col, def] of [
    ["clients", "rate", "REAL NOT NULL DEFAULT 0"],
    ["time_entries", "invoice_id", "INTEGER REFERENCES invoices(id) ON DELETE SET NULL"],
    ["invoices", "template", "TEXT NOT NULL DEFAULT 'classic'"],
    ["invoices", "stripe_payment_link", "TEXT"],
    ["invoices", "paid_via_stripe", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "public_token", "TEXT"],
    ["clients", "portal_token", "TEXT"],
    ["invoices", "paid_at", "TEXT"],
    ["projects", "budget_hours", "REAL"],
    ["projects", "budget_amount", "REAL"],
    ["clients", "rounding_minutes", "INTEGER"],
  ] as const) {
    try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); }
    catch { /* column already exists */ }
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_portal_token ON clients(portal_token)");

  const ENTRY_SELECT = `
  SELECT e.id, e.project_id, e.description, e.start_time, e.end_time, e.invoice_id,
         p.name AS project_name, c.name AS client_name, c.color AS client_color
  FROM time_entries e
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN clients c ON c.id = p.client_id`;

  const qRunning = db.query(`${ENTRY_SELECT} WHERE e.end_time IS NULL ORDER BY e.start_time DESC LIMIT 1`);
  const qOne = db.query(`${ENTRY_SELECT} WHERE e.id = ?`);
  const qRange = db.query(`${ENTRY_SELECT} WHERE e.start_time >= ? AND e.start_time < ? ORDER BY e.start_time DESC`);

  const qInvoice = db.query(
    `SELECT i.*, c.name AS client_name, c.color AS client_color
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`);
  const qInvoiceItems = db.query("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id");
  const qInvoices = db.query(
    `SELECT i.*, c.name AS client_name, c.color AS client_color,
          COALESCE((SELECT SUM(amount) FROM invoice_items WHERE invoice_id = i.id), 0) AS subtotal
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.issue_date DESC, i.id DESC`);

  const qRevenueRows = db.query(
    `SELECT i.id, i.number, i.due_date, i.status, i.tax_rate, i.issue_date, i.client_id,
          c.name AS client_name, c.color AS client_color,
          COALESCE((SELECT SUM(amount) FROM invoice_items WHERE invoice_id = i.id), 0) AS subtotal
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id`);

  return {
    db,
    ENTRY_SELECT,
    qRunning, qOne, qRange, qInvoice, qInvoiceItems, qInvoices, qRevenueRows,
  };
}

export type DbBundle = ReturnType<typeof createDb>;
