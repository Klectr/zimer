/** Database layer: SQLite init, schema, idempotent migrations, demo seeding,
 *  and the shared prepared queries. Everything is created inside createDb()
 *  so server.ts owns DATA_DIR and passes it in; the returned bundle keeps all
 *  existing call sites (db, qRunning, seedDemoData, ...) working unchanged.
 *  Demo seeding/banner will move to lib/demo.ts in a later slice (#167). */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { icon } from "./lib/icons.ts";

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
/* Milestone 8: recurring billing schedules — drafts only, never auto-sent. */
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  source TEXT NOT NULL DEFAULT 'unbilled',
  fixed_amount REAL NOT NULL DEFAULT 0,
  day_of_month INTEGER,
  anchor_date TEXT NOT NULL,
  next_run TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);
  /* Milestone 11: demo data onboarding — fictional workspace seeding and reset. */
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);

  function workspaceEmpty(): boolean {
    const c = (db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n
      + (db.query("SELECT COUNT(*) AS n FROM time_entries").get() as any).n
      + (db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n;
    return c === 0;
  }
  function demoIds(): any | null {
    const r = db.query("SELECT value FROM meta WHERE key = 'demo_ids'").get() as any;
    return r ? JSON.parse(r.value) : null;
  }
  function seedDemoData(): void {
    const ids: any = { clients: [], projects: [], entries: [], invoices: [] };
    const insClient = db.query("INSERT INTO clients (name, color, rate) VALUES (?, ?, ?)");
    const insProject = db.query("INSERT INTO projects (name, client_id) VALUES (?, ?)");
    const insEntry = db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, ?, ?, ?)");
    const demoClients: [string, string, number][] = [
      ["Acme Studios", "#f2c14e", 120],
      ["Brightline Co", "#7cc4ff", 95],
      ["Northwind Traders", "#b39ddb", 150],
    ];
    const clientIds: number[] = [];
    for (const [name, color, rate] of demoClients) {
      clientIds.push(Number(insClient.run(name, color, rate).lastInsertRowid));
    }
    ids.clients = clientIds;
    const demoProjects: [string, number][] = [
      ["Brand refresh", clientIds[0]], ["Website rebuild", clientIds[0]],
      ["Mobile app", clientIds[1]], ["Advisory retainer", clientIds[2]],
    ];
    const projectIds: number[] = [];
    for (const [name, cid] of demoProjects) {
      projectIds.push(Number(insProject.run(name, cid).lastInsertRowid));
    }
    ids.projects = projectIds;
    /* A week of entries ending yesterday, ~7h/day, mostly billable. */
    const tasks = [
      [0, "Logo concepts", "09:00", "12:30"], [0, "Style guide", "13:30", "16:00"],
      [1, "Homepage build", "09:15", "12:45"], [1, "CMS integration", "13:30", "17:00"],
      [2, "Onboarding flow", "09:00", "12:00"], [2, "Push notifications", "13:00", "16:30"],
      [3, "Architecture review", "10:00", "12:00"],
      [0, "Client feedback round", "09:30", "11:30"],
      [null, "Inbox zero", "08:30", "09:00"],
    ];
    const days = [6, 5, 4, 3, 2];
    let ti = 0;
    for (const d of days) {
      const dt = new Date();
      dt.setDate(dt.getDate() - d);
      const day = dt.toISOString().slice(0, 10);
      for (let k = 0; k < 2 && ti < tasks.length; k++, ti++) {
        const [pj, desc, st, en] = tasks[ti] as any[];
        ids.entries.push(Number(insEntry.run(
          pj === null ? null : projectIds[pj], desc, `${day}T${st}:00`, `${day}T${en}:00`
        ).lastInsertRowid));
      }
    }
    /* Three invoices: paid, sent, draft. */
    const invQ = db.query("INSERT INTO invoices (client_id, number, issue_date, due_date, status, tax_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const itemQ = db.query("INSERT INTO invoice_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)");
    const mk = (cid: number | null, num: string, issue: string, due: string, status: string,
                items: [string, number, number][], notes = "") => {
      const id = Number(invQ.run(cid, num, issue, due, status, 0, notes).lastInsertRowid);
      for (const [desc, hours, rate] of items) itemQ.run(id, desc, hours, rate, hours * rate);
      ids.invoices.push(id);
    };
    const lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lm = lastMonth.toISOString().slice(0, 10);
    mk(clientIds[0], "DEMO-001", lm, lm, "paid",
      [["Brand refresh — design", 24, 120]], "Paid in full. Thank you!");
    mk(clientIds[1], "DEMO-002", new Date().toISOString().slice(0, 10),
      new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), "sent",
      [["Mobile app — onboarding flow", 18.5, 95]]);
    mk(clientIds[2], "DEMO-003", new Date().toISOString().slice(0, 10),
      new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), "draft",
      [["Advisory retainer — September", 1, 150]], "Demo draft — not a real invoice.");
    db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_ids', ?)")
      .run(JSON.stringify(ids));
  }
  function removeDemoData(): number {
    const ids = demoIds();
    if (!ids) return 0;
    const del = (table: string, list: number[]) => {
      if (!list.length) return 0;
      const marks = list.map(() => "?").join(",");
      return db.query(`DELETE FROM ${table} WHERE id IN (${marks})`).run(...list).changes;
    };
    let n = 0;
    for (const iid of ids.invoices as number[]) n += del("invoice_items", db.query("SELECT id FROM invoice_items WHERE invoice_id = ?").all(iid).map((r: any) => r.id));
    n += del("invoices", ids.invoices);
    n += del("time_entries", ids.entries);
    n += del("projects", ids.projects);
    n += del("clients", ids.clients);
    db.query("DELETE FROM meta WHERE key = 'demo_ids'").run();
    return n;
  }
  /** Demo banner: load prompt when empty, "viewing demo" + reset when demo present. */
  function demoBanner(): string {
    if (demoIds()) return `<div class="demo-banner" data-enter="1">
      ${icon("info")}
      <span><strong>Demo data.</strong> This workspace is filled with fictional examples — poke around, then remove them when you're ready.</span>
      <form method="post" action="/demo/reset" class="inline"><button class="md-text-button" type="submit">Remove demo data</button></form>
    </div>`;
    if (workspaceEmpty()) return `<div class="demo-banner" data-enter="1">
      ${icon("info")}
      <span><strong>New here?</strong> Load a fictional workspace — clients, a week of entries, invoices — and try every page in 30 seconds.</span>
      <form method="post" action="/demo/load" class="inline"><button class="md-filled-button" type="submit">Load demo data</button></form>
    </div>`;
    return "";
  }

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

  /** Milestone 8: recurring schedules with client name/rate. */
  const qSchedules = db.query(
    `SELECT s.*, c.name AS client_name, c.rate AS client_rate
   FROM recurring_schedules s JOIN clients c ON c.id = s.client_id
   ORDER BY s.next_run, s.id`);

  const qRevenueRows = db.query(
    `SELECT i.id, i.number, i.due_date, i.status, i.tax_rate, i.issue_date, i.client_id,
          c.name AS client_name, c.color AS client_color,
          COALESCE((SELECT SUM(amount) FROM invoice_items WHERE invoice_id = i.id), 0) AS subtotal
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id`);

  return {
    db, workspaceEmpty, demoIds, seedDemoData, removeDemoData, demoBanner,
    ENTRY_SELECT,
    qRunning, qOne, qRange, qInvoice, qInvoiceItems, qInvoices, qSchedules, qRevenueRows,
  };
}

export type DbBundle = ReturnType<typeof createDb>;
