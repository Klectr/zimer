#!/usr/bin/env bun
/**
 * Timekeep site — Bun + HTMX + SQLite. Zero npm dependencies.
 *
 *   cd site && bun server.ts
 */

import { Database } from "bun:sqlite";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, normalize, sep } from "node:path";
import { invoicePdf, isInvoiceTemplate, templateList } from "./pdf.ts";
import { stripeConfigured, createPaymentLink, verifyWebhookSignature } from "./stripe.ts";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dir, "data");
const STATIC_DIR = resolve(import.meta.dir, "static");
mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- token ---------------- */
function getToken(): string {
  if (process.env.TIMEKEEP_TOKEN) return process.env.TIMEKEEP_TOKEN;
  const p = join(DATA_DIR, ".token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const t = randomBytes(32).toString("hex");
  writeFileSync(p, t, { mode: 0o600 });
  console.log(`\n  Generated API token (the extension + login page need it):\n\n    ${t}\n`);
  return t;
}
const TOKEN = getToken();

/* ---------------- db ---------------- */
const db = new Database(join(DATA_DIR, "timekeep.db"), { create: true });
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
`);
/* idempotent column additions for DBs created before invoicing landed */
for (const [tbl, col, def] of [
  ["clients", "rate", "REAL NOT NULL DEFAULT 0"],
  ["time_entries", "invoice_id", "INTEGER REFERENCES invoices(id) ON DELETE SET NULL"],
  ["invoices", "template", "TEXT NOT NULL DEFAULT 'classic'"],
  ["invoices", "stripe_payment_link", "TEXT"],
  ["invoices", "paid_via_stripe", "INTEGER NOT NULL DEFAULT 0"],
  ["invoices", "public_token", "TEXT"],
] as const) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); }
  catch { /* column already exists */ }
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token)");

type Entry = {
  id: number;
  project_id: number | null;
  description: string;
  start_time: string;
  end_time: string | null;
  project_name: string | null;
  client_name: string | null;
  client_color: string | null;
  invoice_id: number | null;
};

const ENTRY_SELECT = `
  SELECT e.id, e.project_id, e.description, e.start_time, e.end_time, e.invoice_id,
         p.name AS project_name, c.name AS client_name, c.color AS client_color
  FROM time_entries e
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN clients c ON c.id = p.client_id`;

const qRunning = db.query(`${ENTRY_SELECT} WHERE e.end_time IS NULL ORDER BY e.start_time DESC LIMIT 1`);
const qOne = db.query(`${ENTRY_SELECT} WHERE e.id = ?`);
const qRange = db.query(`${ENTRY_SELECT} WHERE e.start_time >= ? AND e.start_time < ? ORDER BY e.start_time DESC`);

/* ---------------- helpers ---------------- */
function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* ---------------- icons: inline SVG, M3 outlined 24px style, no icon font ---------------- */
const ICONS: Record<string, string> = {
  timer: `<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 1.5"/><path d="M9.5 2.5h5"/><path d="M12 2.5V5.5"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>`,
  group: `<circle cx="9" cy="8" r="3.5"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="16.8" cy="9" r="2.7"/><path d="M15.9 14.7c2.5.2 4.2 1.6 4.7 4.3"/>`,
  receipt: `<path d="M6 3.5h12V21l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8.5h6M9 12.5h6"/>`,
  download: `<path d="M12 4v11"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 20h14"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  card: `<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><path d="M6.5 14.5h4"/>`,
  add: `<path d="M12 5v14M5 12h14"/>`,
  chevron_left: `<path d="M14.5 6l-6 6 6 6"/>`,
  chevron_right: `<path d="M9.5 6l6 6-6 6"/>`,
  arrow_left: `<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>`,
  refresh: `<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3.5V8h-4.5"/>`,
  delete: `<path d="M4 7h16"/><path d="M10 7V4.5h4V7"/><path d="M6.5 7l.9 13a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13"/><path d="M10 11v6M14 11v6"/>`,
  edit: `<path d="M4 20h4l11-11a1.8 1.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>`,
  palette: `<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-.8 1.9-1.7 0-1.3-1.1-1.7-1.1-2.8 0-1.1.9-2 2.2-2h2.1a3.9 3.9 0 0 0 3.9-3.9c0-3.6-4-6.6-9-6.6z"/><circle cx="7.6" cy="11.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="7.6" r="1.2" fill="currentColor" stroke="none"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11.5v5"/><circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none"/>`,
  play: `<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>`,
  stop: `<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>`,
};
function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function durationSeconds(startIso: string, endIso: string | null): number {
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, Math.round((end - new Date(startIso).getTime()) / 1000));
}

function fmtDur(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Local-day bounds as ISO strings: YYYY-MM-DD in server-local time. */
function dayBounds(dateStr: string): [string, string] {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0);
  return [start.toISOString(), end.toISOString()];
}

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function entryToJson(e: Entry) {
  return {
    id: e.id,
    project_id: e.project_id,
    description: e.description,
    start_time: e.start_time,
    end_time: e.end_time,
    duration_seconds: durationSeconds(e.start_time, e.end_time),
    project_name: e.project_name,
    client_name: e.client_name,
    client_color: e.client_color,
  };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...extra } });

/* ---------------- invoicing helpers ---------------- */
const round2 = (n: number) => Math.round(n * 100) / 100;

function money(n: number): string {
  return "$" + round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type InvoiceItem = { id: number; description: string; hours: number; rate: number; amount: number };
type Invoice = {
  id: number; client_id: number | null; number: string; issue_date: string; due_date: string | null;
  status: string; tax_rate: number; notes: string; template: string; created_at: string;
  stripe_payment_link: string | null; paid_via_stripe: number; public_token: string | null;
  client_name: string | null; client_color: string | null;
};

const qInvoice = db.query(
  `SELECT i.*, c.name AS client_name, c.color AS client_color
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`);
const qInvoiceItems = db.query("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id");
const qInvoices = db.query(
  `SELECT i.*, c.name AS client_name, c.color AS client_color,
          COALESCE((SELECT SUM(amount) FROM invoice_items WHERE invoice_id = i.id), 0) AS subtotal
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.issue_date DESC, i.id DESC`);

function getInvoice(id: number): (Invoice & { items: InvoiceItem[] }) | null {
  const inv = qInvoice.get(id) as Invoice | null;
  if (!inv) return null;
  const items = qInvoiceItems.all(id) as InvoiceItem[];
  return { ...inv, items };
}

/** Random public share token: 24 bytes = 192 bits of entropy, URL-safe. */
function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Mint and persist a public share token for an invoice if it lacks one. */
function ensurePublicToken(id: number): string {
  return getPublicToken(id) ?? mintPublicToken(id);
}

/** Current public share token for an invoice, or null if none (never mints). */
function getPublicToken(id: number): string | null {
  return (db.query("SELECT public_token FROM invoices WHERE id = ?").get(id) as any)?.public_token ?? null;
}

/** Mint a fresh public share token, replacing any existing one. */
function mintPublicToken(id: number): string {
  for (let i = 0; i < 5; i++) {
    const tok = newPublicToken();
    try {
      db.query("UPDATE invoices SET public_token = ? WHERE id = ?").run(tok, id);
      return tok;
    } catch { /* token collision — retry */ }
  }
  throw new Error("could not mint public token");
}

/** Best-effort public origin for share links (honors reverse-proxy headers). */
function publicOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || `localhost:${PORT}`;
  const proto = req.headers.get("x-forwarded-proto")
    || (/^(localhost|127\.|10\.|192\.168\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Public client invoice page: no auth, read-only, no actions or navigation. */
function publicInvoicePage(inv: Invoice & { items: InvoiceItem[] }): string {
  const t = invoiceTotals(inv.items, inv.tax_rate);
  const pay = inv.stripe_payment_link ? `
    <div class="no-print public-pay">
      <a class="md-filled-button public-pay-btn" href="${esc(inv.stripe_payment_link)}" target="_blank" rel="noopener">${icon("card")}<span>Pay ${money(t.total)}</span></a>
    </div>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Invoice ${esc(inv.number)} · Timekeep</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/static/style.css">
<script src="/static/motion.js" defer></script>
</head>
<body>
<main class="page-public-invoice">
${invoiceSheet(inv)}
${pay}
<p class="muted tiny no-print public-foot">Shared securely via Timekeep</p>
</main>
</html>`;
}

function invoiceTotals(items: InvoiceItem[], taxRate: number) {
  const subtotal = round2(items.reduce((a, it) => a + it.amount, 0));
  const tax = round2(subtotal * taxRate / 100);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

function nextInvoiceNumber(): string {
  const r = db.query("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM invoices").get() as any;
  return "INV-" + String(r.n).padStart(4, "0");
}

/** Create (or regenerate) a Stripe payment link for a sent invoice. */
async function stripeLinkFor(id: number): Promise<{ url?: string; error?: string; status?: number }> {
  const inv = qInvoice.get(id) as Invoice | null;
  if (!inv) return { error: "not found", status: 404 };
  if (inv.status !== "sent") return { error: "only sent invoices can collect via Stripe", status: 400 };
  if (!stripeConfigured()) return { error: "STRIPE_SECRET_KEY not configured", status: 503 };
  const full = getInvoice(id)!;
  const t = invoiceTotals(full.items, full.tax_rate);
  try {
    const link = await createPaymentLink({
      invoiceId: id,
      number: inv.number,
      clientName: inv.client_name || "",
      totalCents: Math.round(t.total * 100),
    });
    db.query("UPDATE invoices SET stripe_payment_link = ? WHERE id = ?").run(link.url, id);
    return { url: link.url };
  } catch (e: any) {
    return { error: e?.message || "Stripe request failed", status: 502 };
  }
}

/* ---------------- revenue (milestone 1) ---------------- */
type RevenueRow = {
  status: string; tax_rate: number; issue_date: string;
  client_id: number | null; client_name: string | null; client_color: string | null;
  subtotal: number;
};

const qRevenueRows = db.query(
  `SELECT i.status, i.tax_rate, i.issue_date, i.client_id,
          c.name AS client_name, c.color AS client_color,
          COALESCE((SELECT SUM(amount) FROM invoice_items WHERE invoice_id = i.id), 0) AS subtotal
   FROM invoices i LEFT JOIN clients c ON c.id = i.client_id`);

const revenueTotal = (r: RevenueRow) => round2(r.subtotal * (1 + (r.tax_rate || 0) / 100));

/** A1: top-level revenue totals, tax-inclusive. */
function revenueTotals() {
  const rows = qRevenueRows.all() as RevenueRow[];
  const invoiced = round2(rows.reduce((a, r) => a + revenueTotal(r), 0));
  const paid = round2(rows.filter(r => r.status === "paid").reduce((a, r) => a + revenueTotal(r), 0));
  return { invoiced, paid, outstanding: round2(invoiced - paid) };
}

/** A2: trailing 12-month revenue (tax-inclusive), oldest → newest. */
function revenueMonthly() {
  const rows = qRevenueRows.all() as RevenueRow[];
  const now = new Date();
  const months: { month: string; label: string; invoiced: number; paid: number }[] = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      invoiced: 0, paid: 0,
    });
  }
  for (const r of rows) {
    const m = months.find(m => m.month === String(r.issue_date).slice(0, 7));
    if (!m) continue;
    const t = revenueTotal(r);
    m.invoiced = round2(m.invoiced + t);
    if (r.status === "paid") m.paid = round2(m.paid + t);
  }
  return months;
}

/** A3: per-client revenue (tax-inclusive), sorted by invoiced desc. */
function revenueByClient() {
  const rows = qRevenueRows.all() as RevenueRow[];
  const map = new Map<number, { client_id: number; name: string; color: string | null; invoiced: number; paid: number }>();
  for (const r of rows) {
    if (r.client_id == null) continue;
    const e = map.get(r.client_id) ?? {
      client_id: r.client_id, name: r.client_name || "Unknown",
      color: r.client_color, invoiced: 0, paid: 0,
    };
    const t = revenueTotal(r);
    e.invoiced = round2(e.invoiced + t);
    if (r.status === "paid") e.paid = round2(e.paid + t);
    map.set(r.client_id, e);
  }
  return [...map.values()]
    .map(e => ({ ...e, outstanding: round2(e.invoiced - e.paid) }))
    .sort((a, b) => b.invoiced - a.invoiced);
}

/** Unbilled, finished entries for a client's projects inside [from, to). */
function unbilledEntries(clientId: number, from: string, to: string) {
  return db.query(
    `SELECT e.id, e.project_id, e.description, e.start_time, e.end_time,
            p.name AS project_name
     FROM time_entries e
     JOIN projects p ON p.id = e.project_id
     WHERE e.invoice_id IS NULL AND e.end_time IS NOT NULL
       AND p.client_id = ? AND e.start_time >= ? AND e.start_time < ?
     ORDER BY e.start_time`).all(clientId, from, to) as any[];
}

/** Group entries by project into draft line items. */
function groupToLineItems(entries: any[], rate: number) {
  const groups = new Map<number, { project: string; ids: number[]; secs: number }>();
  for (const e of entries) {
    const g = groups.get(e.project_id) ?? { project: e.project_name, ids: [], secs: 0 };
    g.ids.push(e.id);
    g.secs += durationSeconds(e.start_time, e.end_time);
    groups.set(e.project_id, g);
  }
  return [...groups.values()].map(g => {
    const hours = round2(g.secs / 3600);
    return { description: g.project, hours, rate, amount: round2(hours * rate), entry_ids: g.ids };
  });
}

function statusPill(status: string): string {
  const label = status[0].toUpperCase() + status.slice(1);
  return `<span class="pill pill-${esc(status)}">${esc(label)}</span>`;
}

/* ---------------- auth ---------------- */
function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function authedApi(req: Request): boolean {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") && tokensEqual(h.slice(7).trim(), TOKEN);
}

function authedPage(req: Request): boolean {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)tk=([^;]+)/);
  if (!m) return false;
  try { return tokensEqual(decodeURIComponent(m[1]), TOKEN); } catch { return false; }
}

/* ---------------- views ---------------- */
function layout(title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean): string {
  const navItem = (href: string, label: string, key: string, ic: keyof typeof ICONS) =>
    `<a href="${href}" title="${label}" class="md-top-nav-item${active === key ? " active" : ""}"${active === key ? ` aria-current="page"` : ""}>${icon(ic)}<span>${label}</span></a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Timekeep</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/static/style.css">
<script src="/static/motion.js" defer></script>
</head>
<body${fixed ? ' class="app-fixed"' : ""}>
<header class="md-top-app-bar" data-enter="1">
  <span class="md-top-app-bar-title">${icon("timer")}<span>Timekeep</span></span>
  <nav class="md-top-nav" aria-label="Primary">
    ${navItem("/", "Timer", "timer", "timer")}
    ${navItem("/calendar", "Calendar", "calendar", "calendar")}
    ${navItem("/invoices", "Invoices", "invoices", "receipt")}
    ${navItem("/manage", "Clients & projects", "manage", "group")}
  </nav>
  <span class="md-top-app-bar-spacer"></span>
  <a class="md-text-button" href="/logout">Log out</a>
</header>
<main${active ? ` class="page-${active}"` : ""}>${body}</main>
</html>`;
}

/* Minimal public chrome for error pages: no nav, no logout, no app
   structure leaked. Mirrors the public invoice page's head. */
function publicShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} &middot; Timekeep</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/static/style.css">
<script src="/static/motion.js" defer></script>
</head>
<body>
<main class="page-public-invoice">
${body}
</main>
</html>`;
}

/* Styled 404 page. Authed requests get the app layout with wayfinding;
   anonymous requests (bad /i/:token, logged-out misses) get the minimal
   public chrome — no nav, no logout, no app structure leaked. */
function notFoundPage(authed: boolean): string {
  const body = `
    <div class="error-page">
      <h1 class="md-headline-small">Page not found</h1>
      <p class="muted">The page you&rsquo;re looking for doesn&rsquo;t exist or was moved.</p>
      ${authed ? `
      <div class="error-actions">
        <a class="md-filled-button" href="/">Timer</a>
        <a class="md-text-button" href="/calendar">Calendar</a>
        <a class="md-text-button" href="/invoices">Invoices</a>
      </div>` : ""}
    </div>`;
  if (authed) return layout("Page not found", body);
  return publicShell("Page not found", body);
}

/* Styled 500 page, rendered by the page-route catch-all. Never includes
   error details — those go to the server log only. */
function errorPage(authed: boolean): string {
  const body = `
    <div class="error-page">
      <h1 class="md-headline-small">Something went wrong</h1>
      <p class="muted">An unexpected error occurred. Please try again.</p>
      <div class="error-actions">
        <button class="md-tonal-button" onclick="history.back()">Go back</button>
        <a class="md-filled-button" href="/">Timer</a>
      </div>
    </div>`;
  if (authed) return layout("Something went wrong", body);
  return publicShell("Something went wrong", body);
}

function projectOptions(selected: number | null = null): string {
  const rows = db.query(
    `SELECT p.id, p.name, c.name AS client FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.name`).all() as any[];
  return rows.map(r =>
    `<option value="${r.id}"${r.id === selected ? " selected" : ""}>${esc(r.name)}${r.client ? ` (${esc(r.client)})` : ""}</option>`
  ).join("");
}

function entryRow(e: Entry, i = 0): string {
  const dur = fmtDur(durationSeconds(e.start_time, e.end_time));
  const when = e.end_time ? `${fmtTime(e.start_time)} – ${fmtTime(e.end_time)}` : `${fmtTime(e.start_time)} – now`;
  const chip = e.project_name
    ? `<span class="md-chip">${e.client_color ? `<span class="dot" style="background:${esc(e.client_color)}"></span>` : ""}${esc(e.project_name)}</span>`
    : "";
  const desc = e.description ? esc(e.description) : "<em>No description</em>";
  return `<li class="md-list-item" id="entry-${e.id}" style="animation-delay:${Math.min(i * 30, 300)}ms">
    <div class="md-list-item-content">
      <div class="md-list-item-headline">${desc}</div>
      <div class="md-list-item-supporting">${chip}<span>${esc(when)}${e.client_name && !e.project_name ? ` · ${esc(e.client_name)}` : ""}</span></div>
    </div>
    <div class="md-list-item-trailing">
      <span class="dur">${dur}</span>
      <a class="md-icon-button" href="/entries/${e.id}/edit" aria-label="Edit entry" title="Edit">${icon("edit")}</a>
      <button class="md-icon-button danger" hx-delete="/entries/${e.id}"
        hx-target="#entry-${e.id}" hx-swap="outerHTML swap:220ms" hx-confirm="Delete this entry?"
        aria-label="Delete entry" title="Delete">${icon("delete")}</button>
    </div>
  </li>`;
}

/** Timer card: running entry with live ticking, or the start form. */
function timerPartial(): string {
  const running = qRunning.get() as Entry | null;
  if (running) {
    const proj = running.project_name ? ` · ${esc(running.project_name)}` : "";
    return `<div class="md-card tracking" id="timer-card">
      <div class="timer-state-label"><span class="live-dot" aria-hidden="true"></span>TRACKING${proj}</div>
      <div class="md-title-medium">${running.description ? esc(running.description) : "No description"}</div>
      <div class="timer-elapsed" id="elapsed" data-start="${esc(running.start_time)}">…</div>
      <button class="md-extended-fab stop" hx-post="/timer/stop" hx-target="#timer-card" hx-swap="outerHTML swap:200ms">
        ${icon("stop")}Stop
      </button>
      <script>(function(){var el=document.getElementById('elapsed');if(!el)return;
        var s=new Date(el.dataset.start).getTime();
        function tick(){var d=Math.max(0,Date.now()-s);
          var h=Math.floor(d/36e5),m=Math.floor(d%36e5/6e4),sec=Math.floor(d%6e4/1e3);
          el.textContent=(h?h+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');}
        tick();setInterval(tick,1000);})();</script>
    </div>`;
  }
  return `<div class="md-card" id="timer-card">
    <div class="timer-state-label">TIMER</div>
    <div class="md-title-medium muted">Nothing tracking</div>
    <form hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML swap:200ms" class="start-form">
      <div class="md-text-field grow">
        <input type="text" name="description" placeholder=" " autocomplete="off" aria-label="What are you working on?">
        <label>What are you working on?</label>
      </div>
      <div class="md-text-field shrink filled">
        <select name="project_id" aria-label="Project"><option value="">No project</option>${projectOptions()}</select>
        <label>Project</label>
      </div>
      <button class="md-extended-fab" type="submit">
        ${icon("play")}Start
      </button>
    </form>
  </div>`;
}

function todayPartial(): string {
  const [from, to] = dayBounds(todayStr());
  const entries = qRange.all(from, to) as Entry[];
  if (!entries.length) return `<p class="muted">Nothing tracked today yet.</p>`;
  const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
  return `<div class="day-total md-title-small">Today · <strong>${fmtDur(total)}</strong></div>
    <ul class="md-list">${entries.map(entryRow).join("")}</ul>`;
}

function dashboardPage(): string {
  return layout("Timer", `
    <div class="pane-layout">
      <section class="pane-focus" data-enter="2" aria-label="Timer and today's entries">
        <div hx-get="/partial/timer" hx-trigger="load" hx-swap="outerHTML swap:200ms"><div class="md-card"><p class="muted">Loading…</p></div></div>
        <div class="scroll-region">
          <h2 class="md-headline-small">Today</h2>
          <div id="today-list" hx-get="/partial/today" hx-trigger="load, timer-updated from:body"></div>
        </div>
      </section>
      <aside class="pane-supporting" data-enter="3" aria-label="Revenue">
        <div class="scroll-region">
          <h2 class="md-headline-small">Revenue</h2>
          ${revenueSection()}
        </div>
      </aside>
    </div>`, "timer", true);
}

/** A1: revenue stat cards (invoiced / paid / outstanding). */
function revenueCards(): string {
  const t = revenueTotals();
  const card = (label: string, val: number, cls = "") => `
    <div class="md-card rev-card">
      <div class="md-label-medium muted">${label}</div>
      <div class="md-title-large${cls ? ` ${cls}` : ""}">${money(val)}</div>
    </div>`;
  return `<div class="rev-cards">
    ${card("Invoiced", t.invoiced)}
    ${card("Paid", t.paid, "rev-paid")}
    ${card("Outstanding", t.outstanding)}
  </div>`;
}

/** A2: trailing-12-month bar chart, hand-rolled SVG. Gold = paid, tonal = outstanding remainder. */
function revenueChart(): string {
  const months = revenueMonthly();
  const max = Math.max(1, ...months.map(m => m.invoiced));
  const W = 600, baseline = 190, areaH = 160, n = months.length;
  const slot = W / n, bw = 30;
  const bars = months.map((m, i) => {
    const h = Math.round(m.invoiced / max * areaH);
    const hp = m.invoiced > 0 ? Math.round(m.paid / m.invoiced * h) : 0;
    const ho = h - hp;
    const x = Math.round(i * slot + (slot - bw) / 2);
    const cx = Math.round(i * slot + slot / 2);
    return `<g><title>${esc(`${m.label}: ${money(m.paid)} paid of ${money(m.invoiced)} invoiced`)}</title>` +
      (ho > 0 ? `<rect x="${x}" y="${baseline - h}" width="${bw}" height="${ho}" rx="4" class="bar-out" style="animation-delay:${i * 40}ms"/>` : "") +
      (hp > 0 ? `<rect x="${x}" y="${baseline - hp}" width="${bw}" height="${hp}" rx="4" class="bar-paid" style="animation-delay:${i * 40}ms"/>` : "") +
      `<text x="${cx}" y="${baseline + 18}" text-anchor="middle">${m.label}</text></g>`;
  }).join("");
  return `<div class="md-card rev-chart-card">
    <div class="md-title-medium rev-chart-title">Last 12 months</div>
    <svg class="rev-chart" viewBox="0 0 ${W} 215" role="img" aria-label="Monthly revenue, last 12 months">${bars}</svg>
    <div class="rev-legend"><span class="rev-swatch paid"></span>Paid<span class="rev-swatch out"></span>Invoiced</div>
  </div>`;
}

function revenueSection(): string {
  if (revenueTotals().invoiced === 0)
    return `<p class="muted">No invoices yet — revenue will show up here.</p>`;
  return revenueCards() + revenueChart() + revenueClients();
}

/** A3: per-client revenue breakdown. */
function revenueClients(): string {
  const clients = revenueByClient();
  if (!clients.length) return "";
  const rows = clients.map(c => `
    <li class="md-list-item">
      <span class="rev-dot" style="background:${esc(c.color || "#f2c14e")}"></span>
      <div class="md-list-item-content">
        <div class="md-list-item-headline">${esc(c.name)}</div>
        <div class="md-list-item-supporting">${money(c.paid)} paid · ${money(c.outstanding)} outstanding</div>
      </div>
      <div class="md-list-item-trailing"><span class="dur">${money(c.invoiced)}</span></div>
    </li>`).join("");
  return `<div class="md-card rev-clients-card">
    <div class="md-title-medium rev-chart-title">By client</div>
    <ul class="md-list">${rows}</ul>
  </div>`;
}

/** Monday of the week containing dateStr (or today). Returns YYYY-MM-DD. */
function mondayOf(dateStr?: string): string {
  const base = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const day = (base.getDay() + 6) % 7; // 0 = Monday
  const mon = new Date(base.getFullYear(), base.getMonth(), base.getDate() - day);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Pixels per hour in the calendar time grid. */
const CAL_HOUR_PX = 52;

/** Weekly hours target: 40h matches the ~80h biweekly invoicing pace.
    Kept as a constant in this slice; a configurable target is a follow-up. */
const WEEK_TARGET_SECS = 40 * 3600;

/** Slim pacing bar under the week header: tracked hours vs the 40h target. */
function weekTargetBar(weekTotalSecs: number): string {
  const pct = Math.min(100, (weekTotalSecs / WEEK_TARGET_SECS) * 100);
  const over = weekTotalSecs >= WEEK_TARGET_SECS;
  return `
    <div class="week-target">
      <div class="week-target-track" role="progressbar" aria-valuenow="${Math.round(pct)}"
        aria-valuemin="0" aria-valuemax="100" aria-label="Weekly hours target, 40 hours">
        <div class="week-target-fill" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <div class="md-label-medium muted week-target-label">${fmtDur(weekTotalSecs)} / 40h${over ? ` · <span class="tiny">over target</span>` : ""}</div>
    </div>`;
}

/** Inner HTML of the #week section (everything that changes when entries do).
    Served full-page via weekGrid() and in-place via GET /partial/week (#65). */
function weekInner(weekStr?: string): string {
  const mon = mondayOf(weekStr);
  const prev = addDays(mon, -7), next = addDays(mon, 7);
  const isThisWeek = mon === mondayOf();
  const today = todayStr();

  // Fetch the whole week in one query, then bucket entries by local day.
  const [wFrom, wTo] = [mon + "T00:00:00", addDays(mon, 7) + "T00:00:00"];
  const rows = db.query(
    `${ENTRY_SELECT} WHERE e.start_time >= ? AND e.start_time < ? ORDER BY e.start_time`).all(wFrom, wTo) as Entry[];
  const byDay = new Map<string, Entry[]>();
  for (const e of rows) {
    const d = new Date(e.start_time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(e);
  }

  /* Per-client week totals from the same query (no extra DB hit), sorted
     descending. Entries without a client roll into a "No client" bucket. */
  const byClient = new Map<string, { name: string; color: string | null; secs: number }>();
  for (const e of rows) {
    const key = e.client_name ?? "__none";
    const cur = byClient.get(key) ?? { name: e.client_name ?? "No client", color: e.client_color, secs: 0 };
    cur.secs += durationSeconds(e.start_time, e.end_time);
    byClient.set(key, cur);
  }
  const clientRows = [...byClient.values()].sort((a, b) => b.secs - a.secs);
  const uninvoiced = rows.reduce(
    (s, e) => s + (e.invoice_id == null ? durationSeconds(e.start_time, e.end_time) : 0), 0);
  const nudgeChip = uninvoiced > 0 ? `
    <a class="nudge-chip" href="/invoices/new">
      <span class="md-label-large">${fmtDur(uninvoiced)} not yet invoiced</span>
      <span class="md-label-large nudge-go">→ New invoice</span>
    </a>` : "";
  const clientStrip = clientRows.length === 0 ? "" : `
    <div class="week-clients">
      ${clientRows.map(c => `
        <span class="week-client">
          <span class="week-client-dot"${c.color ? ` style="background:${esc(c.color)}"` : ""}></span>
          <span class="md-label-medium">${esc(c.name)}</span>
          <span class="md-label-medium muted">${fmtDur(c.secs)}</span>
        </span>`).join("")}
    </div>`;

  const toMin = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
  const toHM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

  let weekTotal = 0;
  let weekBillable = 0;
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(mon, i);
    const [y, m, d] = day.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const wd = dt.toLocaleDateString([], { weekday: "short" });
    const entries = byDay.get(day) ?? [];
    const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
    /* Billable = entry has a project (hence a client); non-billable = no project. */
    const billable = entries.reduce(
      (a, e) => a + (e.project_id != null ? durationSeconds(e.start_time, e.end_time) : 0), 0);
    weekTotal += total;
    weekBillable += billable;
    const isToday = day === today;
    /* Subtle tint for past days under 8h; never tint today or future days. */
    const pastShort = day < today && total < 8 * 3600;

    // Entries render full-width; an entry involved in an overlap gets a top
    // drop shadow so it reads as elevated above the entry beneath it.
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const sortedBlocks = entries
      .map((e) => {
        const a = toMin(e.start_time);
        const b = Math.max(e.end_time ? toMin(e.end_time) : nowMin, a + 15);
        return { e, a, b };
      })
      .sort((x, y) => x.a - y.a);
    const entryHtml = sortedBlocks
      .map(({ e, a, b }) => {
      const top = (a / 60) * CAL_HOUR_PX;
      const h = Math.max(((b - a) / 60) * CAL_HOUR_PX, 26);
      const color = e.client_color || "#9aa0a6"; // no-client: neutral gray, distinct from client colors
      const running = !e.end_time;
      const overlap = sortedBlocks.some((o) => o.e !== e && o.a < b && o.b > a);
      const desc = e.description ? esc(e.description) : "<em>No description</em>";
      const dur = fmtDur(durationSeconds(e.start_time, e.end_time));
      return `<div class="cal-entry${running ? " running" : ""}${overlap ? " overlap" : ""}"
          style="top:${top.toFixed(1)}px;height:${h.toFixed(1)}px;--c:${esc(color)}"
          data-id="${e.id}" data-desc="${esc(e.description)}" data-project-id="${e.project_id ?? ""}"
          data-date="${day}" data-start="${toHM(a)}" data-end="${running ? "" : toHM(Math.min(b, 1439))}"
          tabindex="0" role="button" aria-label="${desc}, ${dur}">
        <div class="cal-entry-desc">${e.project_name ? `<strong>${esc(e.project_name)}</strong> · ` : ""}${desc}</div>
        <div class="cal-entry-dur">${dur}</div>
      </div>`;
    }).join("");
    const nowLine = isToday
      ? `<div class="cal-now" id="cal-now" style="top:${((nowMin / 60) * CAL_HOUR_PX).toFixed(1)}px"></div>` : "";
    days.push(`<div class="cal-day${isToday ? " today" : ""}${pastShort ? " paced-short" : ""}" style="animation-delay:${i * 40}ms">
      <div class="cal-day-head">
        <div class="md-label-large muted">${esc(wd)}</div>
        <div class="cal-day-num${isToday ? " today" : ""}">${d}</div>
        <div class="tiny muted">${fmtDur(total)}</div>
        ${total > 0 ? `<div class="tiny muted">${fmtDur(billable)} billable</div>` : ""}
      </div>
      <div class="cal-day-col" data-date="${day}">${entryHtml}${nowLine}</div>
    </div>`);
  }

  // Week-over-week delta vs the immediately preceding week.
  const prevRows = qRange.all(addDays(mon, -7) + "T00:00:00", mon + "T00:00:00") as Entry[];
  const prevTotal = prevRows.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
  const deltaHtml = (() => {
    if (prevTotal <= 0) return `<span class="muted">—</span>`;
    const pct = Math.round(((weekTotal - prevTotal) / prevTotal) * 100);
    const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
    return `<span class="muted">${arrow} ${Math.abs(pct)}% vs prev week</span>`;
  })();

  const hourLabels = Array.from({ length: 24 }, (_, h) => {
    const ampm = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
    return `<span class="cal-hour-label" style="top:${(h * CAL_HOUR_PX - 8).toFixed(0)}px">${ampm}</span>`;
  }).join("");

  return `
    <div class="week-nav" data-enter="2">
      <h2 class="md-headline-small">${isThisWeek ? "This week" : `Week of ${esc(mon)}`} <span class="muted">· ${fmtDur(weekTotal)}</span> ${deltaHtml} <span class="muted">· ${fmtDur(weekBillable)} billable</span></h2>
      <div class="week-nav-actions">
        ${isThisWeek ? "" : `<a class="md-text-button" href="/calendar">Today</a>`}
        <a class="md-icon-button" href="/calendar?week=${prev}" title="Previous week" aria-label="Previous week">${icon("chevron_left")}</a>
        <a class="md-icon-button" href="/calendar?week=${next}" title="Next week" aria-label="Next week">${icon("chevron_right")}</a>
      </div>
    </div>
    ${nudgeChip}
    ${weekTargetBar(weekTotal)}
    ${clientStrip}
    <p class="muted tiny cal-hint">Drag on the grid to log time. Click an entry to edit it.</p>
    <div class="cal-scroll" data-enter="3">
      <div class="cal-grid" id="cal-body" style="--cal-hour:${CAL_HOUR_PX}px">
        <div class="cal-gutter-col">
          <div class="cal-gutter-spacer"></div>
          <div class="cal-gutter cal-hours">${hourLabels}</div>
        </div>
        ${days.join("")}
      </div>
    </div>
  `;
}

/** Full calendar week section: the #week wrapper plus the persistent entry
    dialog and calendar script. The dialog and script live outside #week so an
    in-place week refresh (#65) never destroys dialog bindings or duplicates
    listeners. */
function weekGrid(weekStr?: string): string {
  return `<div id="week">${weekInner(weekStr)}</div>
    <div class="cal-scrim" id="cal-scrim" hidden>
      <div class="cal-dialog" role="dialog" aria-modal="true" aria-labelledby="cal-dialog-title">
        <h2 class="md-headline-small" id="cal-dialog-title">New entry</h2>
        <p class="muted md-body-medium" id="cal-dialog-date"></p>
        <div class="md-text-field">
          <input type="text" id="cal-desc" placeholder=" " autocomplete="off">
          <label for="cal-desc">Description</label>
        </div>
        <div class="md-text-field filled">
          <select id="cal-project" aria-label="Project"><option value="">No project</option>${projectOptions()}</select>
          <label for="cal-project">Project</label>
        </div>
        <div class="cal-time-row">
          <div class="md-text-field filled">
            <input type="time" id="cal-start" required>
            <label for="cal-start">Start</label>
          </div>
          <div class="md-text-field filled">
            <input type="time" id="cal-end" required>
            <label for="cal-end">End</label>
          </div>
          <span class="md-title-small" id="cal-dur"></span>
        </div>
        <p class="error tiny" id="cal-error" hidden></p>
        <div class="cal-dialog-actions">
          <button class="md-text-button danger" id="cal-delete" hidden>Delete</button>
          <span class="cal-spacer"></span>
          <button class="md-text-button" id="cal-cancel">Cancel</button>
          <button class="md-filled-button" id="cal-save">Save</button>
        </div>
      </div>
    </div>
    <script>${calScript()}</script>
`;
}

/** Inline script: drag-to-create, click-to-edit, now-line ticking. No htmx needed. */
function calScript(): string {
  return `(function(){
  var HOUR=${CAL_HOUR_PX};
  var scrim=document.getElementById('cal-scrim');
  var dialog=scrim.querySelector('.cal-dialog');
  /* M3 dialog motion: .open drives scrim fade + dialog scale/fade.
     Generation counter keeps rapid open/close/open sequences sane. */
  var scrimGen=0;
  function showScrim(){
    scrimGen++;
    scrim.hidden=false;
    void scrim.offsetWidth; /* commit unhide so the transition runs */
    scrim.classList.add('open');
  }
  function hideScrim(){
    var gen=++scrimGen;
    scrim.classList.remove('open');
    var done=false;
    var finish=function(){ if(done||gen!==scrimGen) return; done=true; scrim.hidden=true; };
    var onEnd=function(e){
      if(e.target===dialog&&e.propertyName==='transform'){
        dialog.removeEventListener('transitionend',onEnd); finish();
      }
    };
    dialog.addEventListener('transitionend',onEnd);
    setTimeout(finish,400);
  }
  var title=document.getElementById('cal-dialog-title');
  var dateLine=document.getElementById('cal-dialog-date');
  var desc=document.getElementById('cal-desc');
  var project=document.getElementById('cal-project');
  var startI=document.getElementById('cal-start');
  var endI=document.getElementById('cal-end');
  var dur=document.getElementById('cal-dur');
  var err=document.getElementById('cal-error');
  var delBtn=document.getElementById('cal-delete');
  var mode='create', editId=null, dayStr='';
  /* grid owns the scroll: land near the current time when today is in view */
  var scroller=document.querySelector('.cal-scroll'), nowEl=document.getElementById('cal-now');
  if(scroller&&nowEl){var r=nowEl.getBoundingClientRect(),s=scroller.getBoundingClientRect();
    scroller.scrollTop=Math.max(0,r.top-s.top+scroller.scrollTop-scroller.clientHeight*0.35);}
  function toMin(t){var p=t.split(':');return (+p[0])*60+(+p[1]);}
  function toHM(m){m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
  function fmtD(mins){var h=Math.floor(mins/60),m=mins%60;return (h?h+'h ':'')+m+'m';}
  function updDur(){var s=toMin(startI.value||'00:00'),e=toMin(endI.value||'00:00');
    dur.textContent=e>s?fmtD(e-s):'';}
  startI.addEventListener('input',updDur); endI.addEventListener('input',updDur);
  function openCreate(date,a,b){
    mode='create'; editId=null; dayStr=date;
    title.textContent='New entry'; delBtn.hidden=true; err.hidden=true;
    var d=new Date(date+'T12:00:00');
    dateLine.textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
    desc.value=''; project.value='';
    startI.value=toHM(a); endI.value=toHM(b); updDur();
    showScrim(); desc.focus();
  }
  function openEdit(el){
    mode='edit'; editId=el.dataset.id; dayStr=el.dataset.date;
    title.textContent='Edit entry'; delBtn.hidden=false; err.hidden=true;
    var d=new Date(dayStr+'T12:00:00');
    dateLine.textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
    desc.value=el.dataset.desc||''; project.value=el.dataset.projectId||'';
    startI.value=el.dataset.start||'09:00'; endI.value=el.dataset.end||toHM(toMin(startI.value)+60); updDur();
    showScrim(); desc.focus();
  }
  function close(){ hideScrim(); }
  document.getElementById('cal-cancel').addEventListener('click',close);
  scrim.addEventListener('click',function(e){ if(e.target===scrim) close(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&!scrim.hidden) close(); });
  function fail(msg){ err.textContent=msg; err.hidden=false; }
  /* In-place week refresh (#65): re-render the #week section without a full
     page reload. Load-entrance animations are suppressed for the swap
     (no-enter), the grid scroll position is preserved, and the new/updated
     entry gets a one-time highlight. */
  function refreshWeek(highlightId){
    var weekEl=document.getElementById('week');
    var scroller=weekEl.querySelector('.cal-scroll');
    var st=scroller?scroller.scrollTop:0;
    var wk='';
    try{ wk=new URLSearchParams(location.search).get('week')||''; }catch(e){}
    fetch('/partial/week?week='+encodeURIComponent(wk)).then(function(r){
      if(!r.ok) throw new Error('refresh failed');
      return r.text();
    }).then(function(html){
      weekEl.classList.add('no-enter');
      weekEl.innerHTML=html;
      var sc2=weekEl.querySelector('.cal-scroll');
      if(sc2) sc2.scrollTop=st;
      if(highlightId){
        var el=weekEl.querySelector('.cal-entry[data-id="'+highlightId+'"]');
        if(el) el.classList.add('cal-flash');
      }
    }).catch(function(){ location.reload(); /* last resort: never leave stale data */ });
  }
  document.getElementById('cal-save').addEventListener('click',function(){
    var s=toMin(startI.value),e=toMin(endI.value);
    if(!(e>s)) return fail('End time must be after start time.');
    var fd=new URLSearchParams();
    fd.set('description',desc.value);
    fd.set('project_id',project.value);
    fd.set('start_time',dayStr+'T'+startI.value);
    fd.set('end_time',dayStr+'T'+endI.value);
    var url=mode==='create'?'/entries':'/entries/'+editId;
    var hid=mode==='edit'?editId:null;
    fetch(url,{method:'POST',body:fd}).then(function(r){
      if(!r.ok) throw new Error('save failed');
      return r.json().catch(function(){ return {}; });
    }).then(function(data){
      if(mode==='create'&&data&&data.id) hid=data.id;
      close();
      refreshWeek(hid);
    }).catch(function(ex){ fail(ex.message); });
  });
  delBtn.addEventListener('click',function(){
    if(!confirm('Delete this entry?')) return;
    fetch('/entries/'+editId,{method:'DELETE'}).then(function(){ close(); refreshWeek(null); });
  });
  // drag-to-create on empty grid space
  var drag=null;
  function minsAt(ev,col){
    var r=col.getBoundingClientRect();
    var y=Math.max(0,Math.min(r.height,ev.clientY-r.top));
    return Math.floor(y/HOUR*(60/15))*(15);
  }
  function place(el,a,b){
    el.style.top=(a/60*HOUR)+'px';
    el.style.height=Math.max((b-a)/60*HOUR,10)+'px';
  }
  /* #65: delegated on document so drag-to-create survives in-place #week refreshes. */
  document.addEventListener('pointerdown',function(e){
    var entryEl=e.target.closest('.cal-entry');
    if(entryEl){ openEdit(entryEl); return; }
    var col=e.target.closest('.cal-day-col');
    if(!col) return;
    e.preventDefault();
    var a=minsAt(e,col);
    var pv=document.createElement('div');
    pv.className='cal-drag-preview';
    col.appendChild(pv); place(pv,a,a+15);
    drag={col:col,a:a,pv:pv,moved:false};
    function move(ev){ drag.moved=true; var m=minsAt(ev,col);
      var x=Math.min(drag.a,m),y=Math.max(drag.a,m); place(pv,x,Math.max(y,x+15)); }
    function up(ev){
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',up);
      var m=drag.moved?minsAt(ev,col):drag.a+60;
      var x=Math.min(drag.a,m),y=Math.max(drag.a,m);
      if(y-x<15) y=x+15;
      drag.pv.remove(); var d={col:drag.col,x:x,y:y}; drag=null;
      openCreate(d.col.dataset.date,d.x,Math.min(d.y,1439));
    }
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
  });
  // keep the now-line pinned to the current time
  function tickNow(){
    var el=document.getElementById('cal-now'); if(!el) return;
    var n=new Date();
    el.style.top=((n.getHours()*60+n.getMinutes())/60*HOUR)+'px';
  }
  setInterval(tickNow,60000);
})();`;
}

function calendarPage(week?: string): string {
  return layout("Calendar", weekGrid(week), "calendar", true);
}

function editPage(id: number): string | null {
  const e = qOne.get(id) as Entry | null;
  if (!e) return null;
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return layout("Edit entry", `
    <h2 class="md-headline-small" data-enter="2">Edit entry</h2>
    <form method="post" action="/entries/${e.id}" class="form">
      <div class="md-text-field">
        <input type="text" name="description" value="${esc(e.description)}" placeholder=" ">
        <label>Description</label>
      </div>
      <div class="md-text-field filled">
        <select name="project_id"><option value="">No project</option>${projectOptions(e.project_id)}</select>
        <label>Project</label>
      </div>
      <div class="md-text-field filled">
        <input type="datetime-local" name="start_time" value="${toLocal(e.start_time)}" required placeholder=" ">
        <label>Start</label>
      </div>
      <div class="md-text-field filled">
        <input type="datetime-local" name="end_time" value="${e.end_time ? toLocal(e.end_time) : ""}" placeholder=" ">
        <label>End (blank = still running)</label>
      </div>
      <div class="row">
        <button class="md-filled-button" type="submit">Save</button>
        <a class="md-text-button" href="/calendar">Cancel</a>
      </div>
    </form>`);
}

function managePage(): string {
  const clients = db.query("SELECT * FROM clients ORDER BY name").all() as any[];
  const projects = db.query(
    `SELECT p.*, c.name AS client_name, c.color AS client_color FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.name`).all() as any[];
  return layout("Clients & Projects", `
    <div class="scroll-region">
    <div class="two-col">
      <section data-enter="2">
        <h2 class="md-headline-small">Clients</h2>
        <form method="post" action="/clients" class="manage-form">
          <div class="md-text-field">
            <input type="text" name="name" placeholder=" " required aria-label="Client name">
            <label>Client name</label>
          </div>
          <div class="manage-form-row">
            <div class="md-text-field has-prefix has-suffix" style="max-width:172px">
              <span class="affix prefix" aria-hidden="true">$</span>
              <input type="number" name="rate" min="0" step="0.01" placeholder=" " aria-label="Hourly rate">
              <label>Hourly rate</label>
              <span class="affix suffix" aria-hidden="true">/hr</span>
            </div>
            <label class="md-color-control" title="Client color">
              ${icon("palette")}
              <span>Color</span>
              <input type="color" name="color" value="#f2c14e" aria-label="Client color">
            </label>
            <span class="manage-form-spacer"></span>
            <button class="md-filled-button" type="submit">${icon("add")}Add</button>
          </div>
        </form>
        ${clients.length ? `<ul class="md-list">${clients.map(c => `<li class="md-list-item" style="min-height:56px">
            <div class="md-list-item-content"><div class="md-list-item-headline"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(c.color)};margin-right:8px"></span>${esc(c.name)}</div></div>
            <div class="md-list-item-trailing">
              <form method="post" action="/clients/${c.id}/rate" class="inline rate-form" title="Hourly rate">
                <div class="md-text-field has-prefix has-suffix compact" style="width:104px">
                  <span class="affix prefix" aria-hidden="true">$</span>
                  <input type="number" name="rate" value="${c.rate || ""}" min="0" step="0.01" placeholder="0" aria-label="Hourly rate for ${esc(c.name)}">
                  <span class="affix suffix" aria-hidden="true">/hr</span>
                </div>
                <button class="md-text-button" type="submit">Save</button>
              </form>
              <form method="post" action="/clients/${c.id}/delete" class="inline"><button class="md-icon-button danger" hx-confirm="Delete client? Projects keep their entries." aria-label="Delete client ${esc(c.name)}" title="Delete">${icon("delete")}</button></form>
            </div>
          </li>`).join("")}</ul>` : `<p class="muted">No clients yet.</p>`}
      </section>
      <section data-enter="3">
        <h2 class="md-headline-small">Projects</h2>
        <form method="post" action="/projects" class="manage-form">
          <div class="md-text-field">
            <input type="text" name="name" placeholder=" " required aria-label="Project name">
            <label>Project name</label>
          </div>
          <div class="manage-form-row">
            <div class="md-text-field filled grow">
              <select name="client_id" aria-label="Client"><option value="">No client</option>
                ${clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
              <label>Client</label>
            </div>
            <button class="md-filled-button" type="submit">${icon("add")}Add</button>
          </div>
        </form>
        ${projects.length ? `<ul class="md-list">${projects.map(p => `<li class="md-list-item" style="min-height:56px">
            <div class="md-list-item-content">
              <div class="md-list-item-headline">${p.client_color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(p.client_color)};margin-right:8px"></span>` : ""}${esc(p.name)}</div>
              ${p.client_name ? `<div class="md-list-item-supporting">${esc(p.client_name)}</div>` : ""}
            </div>
            <div class="md-list-item-trailing">
              <form method="post" action="/projects/${p.id}/delete" class="inline"><button class="md-icon-button danger" hx-confirm="Delete project? Entries keep their history." aria-label="Delete project ${esc(p.name)}" title="Delete">${icon("delete")}</button></form>
            </div>
          </li>`).join("")}</ul>` : `<p class="muted">No projects yet.</p>`}
      </section>
    </div>
    </div>`, "manage", true);
}

function clientOptions(selected: number | null = null): string {
  const rows = db.query("SELECT id, name, rate FROM clients ORDER BY name").all() as any[];
  return rows.map(c =>
    `<option value="${c.id}" data-rate="${c.rate || 0}"${c.id === selected ? " selected" : ""}>${esc(c.name)}</option>`
  ).join("");
}

/** /invoices — list of invoices with status pills and totals. */
function invoicesPage(): string {
  const rows = qInvoices.all() as any[];
  const outstanding = rows
    .filter(r => r.status !== "paid")
    .reduce((a, r) => a + r.subtotal * (1 + (r.tax_rate || 0) / 100), 0);
  const list = rows.length ? `<ul class="md-list">${rows.map(r => {
    return `<li class="md-list-item">
      <div class="md-list-item-content">
        <div class="md-list-item-headline"><a href="/invoices/${r.id}" class="inv-link">${esc(r.number)}</a> ${statusPill(r.status)}</div>
        <div class="md-list-item-supporting">${r.client_name ? esc(r.client_name) : "<em>No client</em>"} · issued ${esc(r.issue_date)}${r.due_date ? ` · due ${esc(r.due_date)}` : ""}</div>
      </div>
      <div class="md-list-item-trailing"><span class="dur">${money(round2(r.subtotal * (1 + (r.tax_rate || 0) / 100)))}</span></div>
    </li>`;
  }).join("")}</ul>` : `<p class="muted">No invoices yet. Create one from your tracked time.</p>`;
  return layout("Invoices", `
    <div class="page-head" data-enter="2">
      <h2 class="md-headline-small">Invoices</h2>
      <a class="md-filled-button" href="/invoices/new">${icon("add")}New invoice</a>
    </div>
    ${rows.length ? `<p class="muted">Outstanding: <strong>${money(outstanding)}</strong></p>` : ""}
    <div class="scroll-region" data-enter="3">${list}</div>`, "invoices", true);
}

type NewInvParams = {
  client_id: string; from: string; to: string; rate: string;
  number: string; issue_date: string; due_date: string; tax_rate: string; notes: string;
};

function defaultNewInvParams(): NewInvParams {
  const t = todayStr();
  return {
    client_id: "", from: addDays(t, -13), to: addDays(t, 1),
    rate: "", number: nextInvoiceNumber(), issue_date: t,
    due_date: addDays(t, 15), tax_rate: "0", notes: "",
  };
}

/** Step 1: pick client + date range. Step 2 (preview): editable line items. */
function invoiceNewPage(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string }): string {
  const clients = db.query("SELECT id, name, rate FROM clients ORDER BY name").all() as any[];
  const selClient = clients.find(c => String(c.id) === p.client_id);
  const step1 = `
    <div class="md-card form-card">
      <h3 class="md-title-medium">1 · Pick unbilled time</h3>
      <div class="form-info">
        ${icon("info")}
        <p>Only finished, unbilled entries on this client's projects are included. Client hourly rates can be set on the <a href="/manage">Clients &amp; projects page</a>.</p>
      </div>
      <form method="post" action="/invoices/preview" class="form">
        <div class="md-text-field filled">
          <select name="client_id" id="inv-client" required aria-label="Client">
            <option value="">Choose a client…</option>${clientOptions(p.client_id ? Number(p.client_id) : null)}
          </select>
          <label>Client</label>
        </div>
        <div class="two-field">
          <div class="md-text-field filled"><input type="date" name="from" value="${esc(p.from)}" required placeholder=" "><label>From</label></div>
          <div class="md-text-field filled"><input type="date" name="to" value="${esc(p.to)}" required placeholder=" "><label>To (exclusive)</label></div>
        </div>
        <div class="two-field">
          <div class="md-text-field filled"><input type="number" name="rate" id="inv-rate" value="${esc(p.rate || (selClient ? String(selClient.rate || "") : ""))}" min="0" step="0.01" placeholder=" "><label>Hourly rate ($)</label></div>
          <div class="md-text-field filled"><input type="number" name="tax_rate" value="${esc(p.tax_rate)}" min="0" step="0.01" placeholder=" "><label>Tax %</label></div>
        </div>
        <div class="two-field">
          <div class="md-text-field"><input type="text" name="number" value="${esc(p.number)}" required placeholder=" "><label>Invoice number</label></div>
        </div>
        <div class="two-field">
          <div class="md-text-field filled"><input type="date" name="issue_date" value="${esc(p.issue_date)}" required placeholder=" "><label>Issue date</label></div>
          <div class="md-text-field filled"><input type="date" name="due_date" value="${esc(p.due_date)}" placeholder=" "><label>Due date</label></div>
        </div>
        <div class="md-text-field"><input type="text" name="notes" value="${esc(p.notes)}" placeholder=" "><label>Notes (optional)</label></div>
        <div class="row end"><button class="md-filled-button" type="submit">Preview line items</button></div>
      </form>
    </div>
    <script>(function(){
      var sel=document.getElementById('inv-client'), rate=document.getElementById('inv-rate');
      sel.addEventListener('change',function(){
        var opt=sel.options[sel.selectedIndex];
        if(opt&&opt.dataset.rate&&!rate.value) rate.value=opt.dataset.rate;
      });
    })();</script>`;

  let step2 = "";
  if (preview) {
    if (preview.emptyMsg) {
      step2 = `<div class="md-card form-card"><h3 class="md-title-medium">2 · Line items</h3><p class="muted">${esc(preview.emptyMsg)}</p></div>`;
    } else {
      const rows = preview.items.map((it, i) => `
        <tr>
          <td><input type="text" name="g${i}_desc" value="${esc(it.description)}" class="cell-input" aria-label="Item description"></td>
          <td><input type="number" name="g${i}_hours" value="${it.hours}" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>
          <td><input type="number" name="g${i}_rate" value="${it.rate}" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>
          <td class="num">${money(it.amount)}</td>
          <input type="hidden" name="g${i}_ids" value="${it.entry_ids.join(",")}">
        </tr>`).join("");
      const t = invoiceTotals(preview.items, Number(p.tax_rate) || 0);
      step2 = `
      <div class="md-card form-card">
        <h3 class="md-title-medium">2 · Review line items</h3>
        <form method="post" action="/invoices" class="form">
          <input type="hidden" name="client_id" value="${esc(p.client_id)}">
          <input type="hidden" name="number" value="${esc(p.number)}">
          <input type="hidden" name="issue_date" value="${esc(p.issue_date)}">
          <input type="hidden" name="due_date" value="${esc(p.due_date)}">
          <input type="hidden" name="tax_rate" value="${esc(p.tax_rate)}">
          <input type="hidden" name="notes" value="${esc(p.notes)}">
          <input type="hidden" name="groups" value="${preview.items.length}">
          <div class="table-wrap"><table class="md-table">
            <thead><tr><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr><td colspan="3">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
              <tr><td colspan="3">Tax (${esc(p.tax_rate)}%)</td><td class="num">${money(t.tax)}</td></tr>
              <tr class="grand"><td colspan="3">Total</td><td class="num">${money(t.total)}</td></tr>
            </tfoot>
          </table></div>
          <p class="muted tiny">Amounts recalculate on save. Entries are marked billed when the invoice is created.</p>
          <div class="row end"><button class="md-filled-button" type="submit">Create invoice</button></div>
        </form>
      </div>`;
    }
  }

  return layout("New invoice", `
    <div class="page-narrow" data-enter="2">
    <div class="page-head">
      <h2 class="md-headline-small">New invoice</h2>
      <a class="md-text-button" href="/invoices">Cancel</a>
    </div>
    ${step1}${step2}
    </div>`, "invoices");
}

/** /invoices/:id — printable detail with status actions. */
/** Template picker + invoice sheet, swapped live by HTMX when the template changes. */
function templatePicker(inv: Invoice): string {
  const opts = templateList().map(t => `
    <button class="tpl-option${t.id === inv.template ? " selected" : ""}" type="button"
      hx-post="/invoices/${inv.id}/template" hx-vals='{"template":"${t.id}"}'
      hx-target="#invoice-doc" hx-swap="outerHTML swap:200ms" aria-pressed="${t.id === inv.template}">${esc(t.name)}</button>`).join("");
  return `<div class="template-picker no-print">
    <span class="md-label-medium muted">Template</span>
    <div class="tpl-options" role="group" aria-label="Invoice template">${opts}</div>
  </div>`;
}

function invoiceSheet(inv: Invoice & { items: InvoiceItem[] }): string {
  const t = invoiceTotals(inv.items, inv.tax_rate);
  const items = inv.items.map(it => `
    <tr>
      <td>${esc(it.description)}</td>
      <td class="num">${it.hours}</td>
      <td class="num">${money(it.rate)}</td>
      <td class="num">${money(it.amount)}</td>
    </tr>`).join("");
  const client = inv.client_name ? esc(inv.client_name) : "<em>No client</em>";
  const paidChip = inv.paid_via_stripe
    ? ` <span class="stripe-paid-chip" title="Marked paid automatically by a Stripe payment">⚡ Paid via Stripe</span>` : "";
  const datesClassic = `
      <div class="inv-dates">
        <div><span class="muted">Issued</span><br><strong>${esc(inv.issue_date)}</strong></div>
        ${inv.due_date ? `<div><span class="muted">Due</span><br><strong>${esc(inv.due_date)}</strong></div>` : ""}
      </div>`;
  const head = inv.template === "minimal" ? `
      <div class="inv-head-min">
        <div>
          <div class="md-label-medium muted">Invoice</div>
          <div class="md-title-large">${esc(inv.number)}</div>
          <div class="muted">${client}</div>
        </div>
        <div class="inv-meta">${statusPill(inv.status)}${paidChip}</div>
      </div>
      <div class="muted tiny inv-dates-min">Issued ${esc(inv.issue_date)}${inv.due_date ? ` · due ${esc(inv.due_date)}` : ""}</div>` : inv.template === "bold" ? `
      <div class="inv-head-bold">
        <div>
          <div class="inv-bold-title">Invoice</div>
          <div class="md-title-medium">${esc(inv.number)}</div>
          <div class="muted">${client}</div>
        </div>
        <div class="inv-meta">${statusPill(inv.status)}${paidChip}</div>
      </div>
      ${datesClassic}` : `
      <div class="inv-head">
        <div>
          <div class="md-headline-small">Invoice ${esc(inv.number)}</div>
          <div class="muted">${client}</div>
        </div>
        <div class="inv-meta">${statusPill(inv.status)}${paidChip}</div>
      </div>
      ${datesClassic}`;
  return `<div class="md-card invoice-sheet template-${esc(inv.template)}">
      ${head}
      <div class="table-wrap"><table class="md-table">
        <thead><tr><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${items || `<tr><td colspan="4" class="muted">No line items.</td></tr>`}</tbody>
        <tfoot>
          <tr><td colspan="3">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
          ${inv.tax_rate ? `<tr><td colspan="3">Tax (${inv.tax_rate}%)</td><td class="num">${money(t.tax)}</td></tr>` : ""}
          <tr class="grand"><td colspan="3">Total due</td><td class="num">${money(t.total)}</td></tr>
        </tfoot>
      </table></div>
      ${inv.notes ? `<p class="inv-notes">${esc(inv.notes)}</p>` : ""}
    </div>`;
}

function invoiceDoc(inv: Invoice & { items: InvoiceItem[] }): string {
  return `<div id="invoice-doc">${templatePicker(inv)}${invoiceSheet(inv)}</div>`;
}

function invoiceDetailPage(inv: Invoice & { items: InvoiceItem[] }, origin: string): string {
  const next = inv.status === "draft" ? "sent" : inv.status === "sent" ? "paid" : null;
  const nextLabel = next === "sent" ? "Mark sent" : next === "paid" ? "Mark paid" : "";
  const t = invoiceTotals(inv.items, inv.tax_rate);
  const token = getPublicToken(inv.id);
  const clientLink = token ? `${origin}/i/${token}` : null;
  const shareSection = clientLink ? `
    <div class="stripe-row no-print">
      <span class="md-label-medium muted">Client link</span>
      <input class="link-input" id="client-link-url" readonly value="${esc(clientLink)}" onclick="this.select()" aria-label="Client invoice link">
      <button class="md-text-button" id="copy-client-link" type="button">${icon("copy")}<span>Copy</span></button>
      <form method="post" action="/invoices/${inv.id}/public-token/regenerate" class="inline">
        <button class="md-text-button" type="submit" title="Create a new link (invalidates the old one)">${icon("refresh")}Regenerate</button>
      </form>
      <form method="post" action="/invoices/${inv.id}/public-token/revoke" class="inline">
        <button class="md-text-button danger" type="submit" onclick="return confirm('Revoke the client link? The current URL will stop working.')">Revoke</button>
      </form>
      <script>(function(){var b=document.getElementById('copy-client-link');if(!b)return;var lbl=b.querySelector('span');b.addEventListener('click',function(){var i=document.getElementById('client-link-url');i.select();var done=function(){lbl.textContent='Copied';setTimeout(function(){lbl.textContent='Copy';},1500);};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(i.value).then(done,done);}else{document.execCommand('copy');done();}});})();</script>
    </div>` : `
    <div class="stripe-row no-print">
      <span class="md-label-medium muted">Client link</span>
      <form method="post" action="/invoices/${inv.id}/public-token/regenerate" class="inline">
        <button class="md-text-button" type="submit">${icon("add")}Create client link</button>
      </form>
    </div>`;
  const stripeSection = inv.status !== "sent" ? "" : `
    <div class="stripe-row no-print">
      ${inv.stripe_payment_link ? `
        <span class="md-label-medium muted">Payment link</span>
        <input class="link-input" id="stripe-link-url" readonly value="${esc(inv.stripe_payment_link)}" onclick="this.select()" aria-label="Stripe payment link">
        <button class="md-text-button" id="copy-stripe-link" type="button">${icon("copy")}<span>Copy</span></button>
        <form method="post" action="/invoices/${inv.id}/stripe-link" class="inline">
          <button class="md-text-button" type="submit" title="Create a new payment link (replaces the old one)">${icon("refresh")}Regenerate</button>
        </form>
        <script>(function(){var b=document.getElementById('copy-stripe-link');if(!b)return;var lbl=b.querySelector('span');b.addEventListener('click',function(){var i=document.getElementById('stripe-link-url');i.select();var done=function(){lbl.textContent='Copied';setTimeout(function(){lbl.textContent='Copy';},1500);};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(i.value).then(done,done);}else{document.execCommand('copy');done();}});})();</script>`
      : stripeConfigured() ? `
        <form method="post" action="/invoices/${inv.id}/stripe-link" class="inline">
          <button class="md-filled-button" type="submit">${icon("card")}Collect via Stripe</button>
        </form>
        <span class="muted tiny">Creates a Stripe payment link for ${money(t.total)}.</span>` : `
        <span class="muted tiny">Set STRIPE_SECRET_KEY to collect via Stripe.</span>`}
    </div>`;
  return layout(`Invoice ${inv.number}`, `
    <div class="page-head no-print" data-enter="2">
      <a class="md-text-button" href="/invoices">${icon("arrow_left")}Invoices</a>
      <div class="row">
        <a class="md-filled-button" href="/invoices/${inv.id}.pdf" download>${icon("download")}Download PDF</a>
        ${next ? `<form method="post" action="/invoices/${inv.id}/status" class="inline">
          <input type="hidden" name="status" value="${next}">
          <button class="md-filled-button" type="submit">${icon("check")}${nextLabel}</button>
        </form>` : ""}
        ${inv.status === "draft" ? `<form method="post" action="/invoices/${inv.id}/delete" class="inline">
          <button class="md-text-button danger" hx-confirm="Delete this draft invoice? Its entries become unbilled again.">Delete</button>
        </form>` : ""}
      </div>
    </div>
    ${shareSection}
    ${stripeSection}
    ${invoiceDoc(inv)}`, "invoices");
}

function loginPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in · Timekeep</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/static/style.css">
<script src="/static/motion.js" defer></script></head>
<body><main class="login">
<div class="md-card" style="border-radius:28px;padding:28px">
<h1 class="md-headline-small" style="margin-top:0">⏱ Timekeep</h1>
<form method="post" action="/login" class="form">
<div class="md-text-field">
  <input type="password" name="token" autocomplete="off" required placeholder=" " aria-label="API token">
  <label>API token</label>
</div>
<button class="md-filled-button" type="submit">Log in</button>
<p class="muted tiny">Printed in the server log on first run, or set via TIMEKEEP_TOKEN.</p>
</form></div></main></body></html>`;
}

/* ---------------- server ---------------- */
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    /* static + login (no auth) */
    if (path.startsWith("/static/")) {
      const p = normalize(join(STATIC_DIR, path.slice("/static/".length)));
      if (!p.startsWith(STATIC_DIR + sep) && p !== STATIC_DIR) return new Response("Forbidden", { status: 403 });
      const f = Bun.file(p);
      if (!(await f.exists())) return html(notFoundPage(authedPage(req)), 404);
      return new Response(f);
    }
    if (path === "/login") {
      if (method === "GET") return html(loginPage());
      if (method === "POST") {
        const form = await req.formData();
        if (tokensEqual(String(form.get("token") || ""), TOKEN)) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: "/",
              "Set-Cookie": `tk=${encodeURIComponent(TOKEN)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000`,
            },
          });
        }
        return html(loginPage().replace("</form>", `<p class="error">Wrong token.</p></form>`), 401);
      }
    }
    if (path === "/logout") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login", "Set-Cookie": "tk=; HttpOnly; Path=/; Max-Age=0" },
      });
    }

    /* Public client invoice page: no auth, read-only. The token is a
       credential — it is never logged, and unknown tokens 404. */
    const pub = path.match(/^\/i\/([A-Za-z0-9_-]{16,64})$/);
    if (pub && method === "GET") {
      const idRow = db.query("SELECT id FROM invoices WHERE public_token = ?").get(pub[1]) as { id: number } | null;
      const inv = idRow ? getInvoice(idRow.id) : null;
      return inv ? html(publicInvoicePage(inv)) : html(notFoundPage(false), 404);
    }

    /* ---- JSON API ---- */
    if (path.startsWith("/api/")) {
      /* ---- Stripe webhook: no Bearer auth — verified by signature instead.
         Reads the raw body; signature is checked before any DB access. ---- */
      if (path === "/api/stripe/webhook" && method === "POST") {
        const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
        if (!secret) return json({ error: "webhook not configured" }, 503);
        const payload = await req.text();
        if (!verifyWebhookSignature(payload, req.headers.get("stripe-signature"), secret))
          return json({ error: "invalid signature" }, 400);
        let event: any;
        try {
          event = JSON.parse(payload);
        } catch {
          return json({ error: "invalid payload" }, 400);
        }
        if (event.type === "checkout.session.completed") {
          const session = event.data?.object || {};
          const invoiceId = Number(session.metadata?.invoice_id || 0);
          if (invoiceId && session.payment_status === "paid") {
            const inv = qInvoice.get(invoiceId) as Invoice | null;
            if (inv && inv.status === "sent") {
              db.query("UPDATE invoices SET status = 'paid', paid_via_stripe = 1 WHERE id = ?").run(invoiceId);
            }
          }
        }
        return json({ received: true });
      }
      try {
        if (!authedApi(req)) return json({ error: "unauthorized" }, 401);
        const body = (await req.json().catch(() => ({}))) as any;

        if (path === "/api/status" && method === "GET") {
          const running = qRunning.get() as Entry | null;
          return json({ running: running ? entryToJson(running) : null });
        }
        if (path === "/api/timer/start" && method === "POST") {
          if (qRunning.get()) return json({ error: "a timer is already running" }, 409);
          const projectId = body.project_id ? Number(body.project_id) : null;
          const r = db.query(
            "INSERT INTO time_entries (project_id, description, start_time) VALUES (?, ?, ?) RETURNING id")
            .get(projectId, String(body.description || ""), new Date().toISOString()) as any;
          return json(entryToJson(qOne.get(r.id) as Entry), 201);
        }
        if (path === "/api/timer/stop" && method === "POST") {
          const running = qRunning.get() as Entry | null;
          if (!running) return json({ error: "no timer running" }, 404);
          db.query("UPDATE time_entries SET end_time = ? WHERE id = ?")
            .run(new Date().toISOString(), running.id);
          return json(entryToJson(qOne.get(running.id) as Entry));
        }
        if (path === "/api/entries" && method === "GET") {
          const from = url.searchParams.get("from") || new Date(0).toISOString();
          const to = url.searchParams.get("to") || new Date().toISOString();
          return json((qRange.all(from, to) as Entry[]).map(entryToJson));
        }
        let m = path.match(/^\/api\/entries\/(\d+)$/);
        if (m) {
          const id = Number(m[1]);
          if (method === "PATCH") {
            const cur = qOne.get(id) as Entry | null;
            if (!cur) return json({ error: "not found" }, 404);
            db.query(`UPDATE time_entries SET description = ?, project_id = ?, start_time = ?, end_time = ? WHERE id = ?`)
              .run(
                body.description !== undefined ? String(body.description) : cur.description,
                body.project_id !== undefined ? (body.project_id ? Number(body.project_id) : null) : cur.project_id,
                body.start_time || cur.start_time,
                body.end_time !== undefined ? (body.end_time || null) : cur.end_time,
                id);
            return json(entryToJson(qOne.get(id) as Entry));
          }
          if (method === "DELETE") {
            db.query("DELETE FROM time_entries WHERE id = ?").run(id);
            return new Response(null, { status: 204 });
          }
        }
        if (path === "/api/clients" && method === "GET")
          return json(db.query("SELECT * FROM clients ORDER BY name").all());
        if (path === "/api/clients" && method === "POST") {
          if (!body.name) return json({ error: "name required" }, 400);
          const r = db.query("INSERT INTO clients (name, color, rate) VALUES (?, ?, ?) RETURNING *")
            .get(String(body.name), String(body.color || "#f2c14e"), Number(body.rate) || 0) as any;
          return json(r, 201);
        }
        m = path.match(/^\/api\/clients\/(\d+)$/);
        if (m && method === "DELETE") {
          db.query("DELETE FROM clients WHERE id = ?").run(Number(m[1]));
          return new Response(null, { status: 204 });
        }
        if (path === "/api/projects" && method === "GET")
          return json(db.query(
            `SELECT p.id, p.name, p.client_id, c.name AS client_name, c.color AS client_color
             FROM projects p LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.name`).all());
        if (path === "/api/projects" && method === "POST") {
          if (!body.name) return json({ error: "name required" }, 400);
          const r = db.query("INSERT INTO projects (name, client_id) VALUES (?, ?) RETURNING *")
            .get(String(body.name), body.client_id ? Number(body.client_id) : null) as any;
          return json(r, 201);
        }
        m = path.match(/^\/api\/projects\/(\d+)$/);
        if (m && method === "DELETE") {
          db.query("DELETE FROM projects WHERE id = ?").run(Number(m[1]));
          return new Response(null, { status: 204 });
        }
        /* ---- invoicing API ---- */
        if (path === "/api/invoices" && method === "GET") {
          const rows = qInvoices.all() as any[];
          return json(rows.map(r => ({
            ...r,
            total: round2(r.subtotal * (1 + (r.tax_rate || 0) / 100)),
          })));
        }
        if (path === "/api/invoices" && method === "POST") {
          const number = String(body.number || nextInvoiceNumber());
          if (db.query("SELECT 1 FROM invoices WHERE number = ?").get(number))
            return json({ error: "invoice number already exists" }, 400);
          let items: { description: string; hours: number; rate: number; entry_ids?: number[] }[];
          if (Array.isArray(body.items)) {
            items = body.items;
          } else {
            if (!body.client_id || !body.from || !body.to)
              return json({ error: "client_id, from, to required (or items[])" }, 400);
            items = groupToLineItems(
              unbilledEntries(Number(body.client_id), String(body.from), String(body.to)),
              Number(body.rate) || 0);
          }
          const clean = items
            .map(it => ({
              description: String(it.description || "Time"),
              hours: round2(Number(it.hours) || 0),
              rate: round2(Number(it.rate) || 0),
              entry_ids: Array.isArray(it.entry_ids) ? it.entry_ids.map(Number).filter(n => n > 0) : [],
            }))
            .filter(it => it.hours > 0);
          if (!clean.length) return json({ error: "no billable line items" }, 400);
          const inv = db.query(
            `INSERT INTO invoices (client_id, number, issue_date, due_date, tax_rate, notes)
             VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
            .get(
              body.client_id ? Number(body.client_id) : null,
              number,
              String(body.issue_date || todayStr()),
              body.due_date ? String(body.due_date) : null,
              Number(body.tax_rate) || 0,
              String(body.notes || "")) as any;
          const insItem = db.query(
            "INSERT INTO invoice_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)");
          const linkEntry = db.query("UPDATE time_entries SET invoice_id = ? WHERE id = ?");
          db.transaction(() => {
            for (const it of clean) {
              insItem.run(inv.id, it.description, it.hours, it.rate, round2(it.hours * it.rate));
              for (const eid of it.entry_ids) linkEntry.run(inv.id, eid);
            }
          })();
          const full = getInvoice(inv.id)!;
          return json({ ...full, ...invoiceTotals(full.items, full.tax_rate) }, 201);
        }
        m = path.match(/^\/api\/invoices\/(\d+)$/);
        if (m) {
          const id = Number(m[1]);
          if (method === "GET") {
            const inv = getInvoice(id);
            if (!inv) return json({ error: "not found" }, 404);
            return json({ ...inv, ...invoiceTotals(inv.items, inv.tax_rate) });
          }
          if (method === "PATCH") {
            const inv = qInvoice.get(id) as Invoice | null;
            if (!inv) return json({ error: "not found" }, 404);
            if (body.template !== undefined) {
              const tpl = String(body.template);
              if (!isInvoiceTemplate(tpl)) return json({ error: "unknown template" }, 400);
              db.query("UPDATE invoices SET template = ? WHERE id = ?").run(tpl, id);
            }
            if (body.status !== undefined) {
              const want = String(body.status);
              const ok = (inv.status === "draft" && want === "sent") ||
                         (inv.status === "sent" && want === "paid");
              if (!ok) return json({ error: "invalid status transition (draft → sent → paid)" }, 400);
              db.query("UPDATE invoices SET status = ? WHERE id = ?").run(want, id);
            }
            const full = getInvoice(id)!;
            return json({ ...full, ...invoiceTotals(full.items, full.tax_rate) });
          }
          if (method === "DELETE") {
            const inv = qInvoice.get(id) as Invoice | null;
            if (!inv) return json({ error: "not found" }, 404);
            if (inv.status !== "draft") return json({ error: "only draft invoices can be deleted" }, 400);
            db.transaction(() => {
              db.query("UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?").run(id);
              db.query("DELETE FROM invoices WHERE id = ?").run(id);
            })();
            return new Response(null, { status: 204 });
          }
        }
        m = path.match(/^\/api\/invoices\/(\d+)\/stripe-link$/);
        if (m && method === "POST") {
          const r = await stripeLinkFor(Number(m[1]));
          return r.url ? json({ url: r.url }) : json({ error: r.error }, r.status);
        }
        /* ---- revenue API (milestone 1) ---- */
        if (path === "/api/revenue" && method === "GET")
          return json({ totals: revenueTotals(), by_month: revenueMonthly(), by_client: revenueByClient() });
        return json({ error: "not found" }, 404);
      } catch (err) {
        console.error(`[timekeep] API ${method} ${path} threw:`, err);
        return json({ error: "internal" }, 500);
      }
    }

    /* ---- pages ---- */
    try {
      if (!authedPage(req)) {
        return new Response(null, { status: 302, headers: { Location: "/login" } });
      }

      if (path === "/" && method === "GET") return html(dashboardPage());
      if (path === "/partial/timer" && method === "GET") return html(timerPartial());
      if (path === "/partial/week" && method === "GET") {
        const w = new URL(req.url).searchParams.get("week") || undefined;
        return html(weekInner(w || undefined));
      }
      if (path === "/partial/today" && method === "GET") return html(todayPartial());
      if (path === "/timer/start" && method === "POST") {
        if (qRunning.get()) return html(timerPartial(), 409);
        const form = await req.formData();
        const pid = form.get("project_id");
        db.query("INSERT INTO time_entries (project_id, description, start_time) VALUES (?, ?, ?)")
          .run(pid ? Number(pid) : null, String(form.get("description") || ""), new Date().toISOString());
        return html(timerPartial(), 200, { "HX-Trigger": "timer-updated" });
      }
      if (path === "/timer/stop" && method === "POST") {
        const running = qRunning.get() as Entry | null;
        if (running) db.query("UPDATE time_entries SET end_time = ? WHERE id = ?").run(new Date().toISOString(), running.id);
        return html(timerPartial(), 200, { "HX-Trigger": "timer-updated" });
      }
      if (path === "/calendar" && method === "GET") return html(calendarPage(url.searchParams.get("week") || undefined));

      if (path === "/entries" && method === "POST") {
        const form = await req.formData();
        const endRaw = String(form.get("end_time") || "");
        const pid = form.get("project_id");
        const ins = db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, ?, ?, ?)")
          .run(
            pid ? Number(pid) : null,
            String(form.get("description") || ""),
            new Date(String(form.get("start_time"))).toISOString(),
            endRaw ? new Date(endRaw).toISOString() : null);
        return json({ ok: true, id: Number(ins.lastInsertRowid) }, 201);
      }

      let m = path.match(/^\/entries\/(\d+)\/edit$/);
      if (m && method === "GET") {
        const page = editPage(Number(m[1]));
        return page ? html(page) : html(notFoundPage(authedPage(req)), 404);
      }
    m = path.match(/^\/entries\/(\d+)$/);
    if (m && method === "POST") {
      const id = Number(m[1]);
      const form = await req.formData();
      const endRaw = String(form.get("end_time") || "");
      const pid = form.get("project_id");
      db.query("UPDATE time_entries SET description = ?, project_id = ?, start_time = ?, end_time = ? WHERE id = ?")
        .run(
          String(form.get("description") || ""),
          pid ? Number(pid) : null,
          new Date(String(form.get("start_time"))).toISOString(),
          endRaw ? new Date(endRaw).toISOString() : null,
          id);
      return new Response(null, { status: 302, headers: { Location: "/calendar" } });
    }
    if (m && method === "DELETE") {
      db.query("DELETE FROM time_entries WHERE id = ?").run(Number(m[1]));
      return new Response("", { status: 200 });
    }

    if (path === "/manage" && method === "GET") return html(managePage());
    if (path === "/clients" && method === "POST") {
      const form = await req.formData();
      db.query("INSERT INTO clients (name, color, rate) VALUES (?, ?, ?)")
        .run(String(form.get("name")), String(form.get("color") || "#f2c14e"),
             Number(form.get("rate") || 0));
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    m = path.match(/^\/clients\/(\d+)\/rate$/);
    if (m && method === "POST") {
      const form = await req.formData();
      db.query("UPDATE clients SET rate = ? WHERE id = ?")
        .run(Number(form.get("rate") || 0), Number(m[1]));
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    m = path.match(/^\/clients\/(\d+)\/delete$/);
    if (m && method === "POST") {
      db.query("DELETE FROM clients WHERE id = ?").run(Number(m[1]));
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    if (path === "/projects" && method === "POST") {
      const form = await req.formData();
      const cid = form.get("client_id");
      db.query("INSERT INTO projects (name, client_id) VALUES (?, ?)")
        .run(String(form.get("name")), cid ? Number(cid) : null);
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    m = path.match(/^\/projects\/(\d+)\/delete$/);
    if (m && method === "POST") {
      db.query("DELETE FROM projects WHERE id = ?").run(Number(m[1]));
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }

    /* ---- invoicing pages ---- */
    if (path === "/invoices" && method === "GET") return html(invoicesPage());
    if (path === "/invoices/new" && method === "GET") return html(invoiceNewPage(defaultNewInvParams()));
    if (path === "/invoices/preview" && method === "POST") {
      const form = await req.formData();
      const p: NewInvParams = {
        client_id: String(form.get("client_id") || ""),
        from: String(form.get("from") || ""),
        to: String(form.get("to") || ""),
        rate: String(form.get("rate") || ""),
        number: String(form.get("number") || nextInvoiceNumber()),
        issue_date: String(form.get("issue_date") || todayStr()),
        due_date: String(form.get("due_date") || ""),
        tax_rate: String(form.get("tax_rate") || "0"),
        notes: String(form.get("notes") || ""),
      };
      if (!p.client_id || !p.from || !p.to) return html(invoiceNewPage(p), 400);
      const entries = unbilledEntries(Number(p.client_id), p.from + "T00:00:00", p.to + "T00:00:00");
      if (!entries.length)
        return html(invoiceNewPage(p, { items: [], emptyMsg: "No unbilled, finished entries on this client's projects in that range." }));
      return html(invoiceNewPage(p, { items: groupToLineItems(entries, Number(p.rate) || 0) }));
    }
    if (path === "/invoices" && method === "POST") {
      const form = await req.formData();
      const groups = Number(form.get("groups") || 0);
      const items: { description: string; hours: number; rate: number; amount: number; entry_ids: number[] }[] = [];
      for (let i = 0; i < groups; i++) {
        const hours = round2(Number(form.get(`g${i}_hours`) || 0));
        const rate = round2(Number(form.get(`g${i}_rate`) || 0));
        const ids = String(form.get(`g${i}_ids`) || "").split(",").map(Number).filter(n => n > 0);
        if (hours <= 0 || !ids.length) continue;
        items.push({
          description: String(form.get(`g${i}_desc`) || "Time"),
          hours, rate, amount: round2(hours * rate), entry_ids: ids,
        });
      }
      if (!items.length) return new Response("No line items — nothing to invoice.", { status: 400 });
      const number = String(form.get("number") || nextInvoiceNumber());
      if (db.query("SELECT 1 FROM invoices WHERE number = ?").get(number))
        return new Response("Invoice number already exists.", { status: 400 });
      const clientId = form.get("client_id") ? Number(form.get("client_id")) : null;
      const dueRaw = String(form.get("due_date") || "");
      const inv = db.query(
        `INSERT INTO invoices (client_id, number, issue_date, due_date, tax_rate, notes)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
        .get(clientId, number, String(form.get("issue_date") || todayStr()),
             dueRaw || null, Number(form.get("tax_rate") || 0), String(form.get("notes") || "")) as any;
      const insItem = db.query(
        "INSERT INTO invoice_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)");
      const linkEntry = db.query("UPDATE time_entries SET invoice_id = ? WHERE id = ?");
      db.transaction(() => {
        for (const it of items) {
          insItem.run(inv.id, it.description, it.hours, it.rate, it.amount);
          for (const eid of it.entry_ids) linkEntry.run(inv.id, eid);
        }
      })();
      return new Response(null, { status: 302, headers: { Location: `/invoices/${inv.id}` } });
    }
    m = path.match(/^\/invoices\/(\d+)$/);
    if (m && method === "GET") {
      const inv = getInvoice(Number(m[1]));
      return inv ? html(invoiceDetailPage(inv, publicOrigin(req))) : html(notFoundPage(authedPage(req)), 404);
    }
    m = path.match(/^\/invoices\/(\d+)\.pdf$/);
    if (m && method === "GET") {
      const inv = getInvoice(Number(m[1]));
      if (!inv) return html(notFoundPage(authedPage(req)), 404);
      const t = invoiceTotals(inv.items, inv.tax_rate);
      const pdf = invoicePdf({
        number: inv.number,
        status: inv.status,
        clientName: inv.client_name || "",
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        items: inv.items.map(it => ({
          description: it.description, hours: it.hours, rate: it.rate, amount: it.amount,
        })),
        subtotal: t.subtotal, tax: t.tax, taxRate: inv.tax_rate, total: t.total,
        notes: inv.notes,
      }, inv.template);
      const filename = inv.number.replace(/[^A-Za-z0-9._-]+/g, "_") + ".pdf";
      return new Response(pdf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }
    m = path.match(/^\/invoices\/(\d+)\/status$/);
    if (m && method === "POST") {
      const form = await req.formData();
      const inv = qInvoice.get(Number(m[1])) as Invoice | null;
      const want = String(form.get("status") || "");
      const ok = !!inv && ((inv.status === "draft" && want === "sent") || (inv.status === "sent" && want === "paid"));
      if (!ok) return new Response("Invalid status transition.", { status: 400 });
      db.query("UPDATE invoices SET status = ? WHERE id = ?").run(want, inv!.id);
      return new Response(null, { status: 302, headers: { Location: `/invoices/${inv!.id}` } });
    }
    m = path.match(/^\/invoices\/(\d+)\/template$/);
    if (m && method === "POST") {
      const form = await req.formData();
      const tpl = String(form.get("template") || "");
      if (!isInvoiceTemplate(tpl)) return new Response("Unknown template.", { status: 400 });
      db.query("UPDATE invoices SET template = ? WHERE id = ?").run(tpl, Number(m[1]));
      const inv = getInvoice(Number(m[1]));
      return inv ? html(invoiceDoc(inv)) : html(notFoundPage(authedPage(req)), 404);
    }
    m = path.match(/^\/invoices\/(\d+)\/stripe-link$/);
    if (m && method === "POST") {
      const r = await stripeLinkFor(Number(m[1]));
      if (r.url) return new Response(null, { status: 302, headers: { Location: `/invoices/${m[1]}` } });
      return new Response(r.error || "Stripe error", { status: r.status || 500 });
    }
    m = path.match(/^\/invoices\/(\d+)\/public-token\/regenerate$/);
    if (m && method === "POST") {
      mintPublicToken(Number(m[1]));
      return new Response(null, { status: 302, headers: { Location: `/invoices/${m[1]}` } });
    }
    m = path.match(/^\/invoices\/(\d+)\/public-token\/revoke$/);
    if (m && method === "POST") {
      db.query("UPDATE invoices SET public_token = NULL WHERE id = ?").run(Number(m[1]));
      return new Response(null, { status: 302, headers: { Location: `/invoices/${m[1]}` } });
    }
    m = path.match(/^\/invoices\/(\d+)\/delete$/);
    if (m && method === "POST") {
      const inv = qInvoice.get(Number(m[1])) as Invoice | null;
      if (!inv) return html(notFoundPage(authedPage(req)), 404);
      if (inv.status !== "draft") return new Response("Only draft invoices can be deleted.", { status: 400 });
      db.transaction(() => {
        db.query("UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?").run(inv.id);
        db.query("DELETE FROM invoices WHERE id = ?").run(inv.id);
      })();
      return new Response(null, { status: 302, headers: { Location: "/invoices" } });
    }

      return html(notFoundPage(authedPage(req)), 404);
    } catch (err) {
      console.error(`[timekeep] page ${method} ${path} threw:`, err);
      return html(errorPage(authedPage(req)), 500);
    }
  },
});

console.log(`\n  ⏱ Timekeep running → http://localhost:${PORT}\n`);
