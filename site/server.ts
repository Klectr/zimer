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
import { invoicePdf } from "./pdf.ts";

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
] as const) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); }
  catch { /* column already exists */ }
}

type Entry = {
  id: number;
  project_id: number | null;
  description: string;
  start_time: string;
  end_time: string | null;
  project_name: string | null;
  client_name: string | null;
  client_color: string | null;
};

const ENTRY_SELECT = `
  SELECT e.id, e.project_id, e.description, e.start_time, e.end_time,
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
  status: string; tax_rate: number; notes: string; created_at: string;
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

function invoiceTotals(items: InvoiceItem[], taxRate: number) {
  const subtotal = round2(items.reduce((a, it) => a + it.amount, 0));
  const tax = round2(subtotal * taxRate / 100);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

function nextInvoiceNumber(): string {
  const r = db.query("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM invoices").get() as any;
  return "INV-" + String(r.n).padStart(4, "0");
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
function layout(title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices"): string {
  const tab = (href: string, label: string, key: string) =>
    `<a href="${href}" class="md-tab${active === key ? " active" : ""}"${active === key ? ` aria-current="page"` : ""}>${label}</a>`;
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
</head>
<body>
<header class="md-top-app-bar">
  <span class="md-top-app-bar-title">⏱ Timekeep</span>
  <span class="md-top-app-bar-spacer"></span>
  <a class="md-text-button" href="/logout">Log out</a>
</header>
<nav class="md-tabs" aria-label="Primary">
  ${tab("/", "Timer", "timer")}
  ${tab("/calendar", "Calendar", "calendar")}
  ${tab("/invoices", "Invoices", "invoices")}
  ${tab("/manage", "Clients & projects", "manage")}
</nav>
<main${active ? ` class="page-${active}"` : ""}>${body}</main>
</html>`;
}

function projectOptions(selected: number | null = null): string {
  const rows = db.query(
    `SELECT p.id, p.name, c.name AS client FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.name`).all() as any[];
  return rows.map(r =>
    `<option value="${r.id}"${r.id === selected ? " selected" : ""}>${esc(r.name)}${r.client ? ` (${esc(r.client)})` : ""}</option>`
  ).join("");
}

function entryRow(e: Entry): string {
  const dur = fmtDur(durationSeconds(e.start_time, e.end_time));
  const when = e.end_time ? `${fmtTime(e.start_time)} – ${fmtTime(e.end_time)}` : `${fmtTime(e.start_time)} – now`;
  const chip = e.project_name
    ? `<span class="md-chip">${e.client_color ? `<span class="dot" style="background:${esc(e.client_color)}"></span>` : ""}${esc(e.project_name)}</span>`
    : "";
  const desc = e.description ? esc(e.description) : "<em>No description</em>";
  return `<li class="md-list-item" id="entry-${e.id}">
    <div class="md-list-item-content">
      <div class="md-list-item-headline">${desc}</div>
      <div class="md-list-item-supporting">${chip}<span>${esc(when)}${e.client_name && !e.project_name ? ` · ${esc(e.client_name)}` : ""}</span></div>
    </div>
    <div class="md-list-item-trailing">
      <span class="dur">${dur}</span>
      <a class="md-icon-button" href="/entries/${e.id}/edit" aria-label="Edit entry" title="Edit">✎</a>
      <button class="md-icon-button danger" hx-delete="/entries/${e.id}"
        hx-target="#entry-${e.id}" hx-swap="outerHTML" hx-confirm="Delete this entry?"
        aria-label="Delete entry" title="Delete">🗑</button>
    </div>
  </li>`;
}

/** Timer card: running entry with live ticking, or the start form. */
function timerPartial(): string {
  const running = qRunning.get() as Entry | null;
  if (running) {
    const proj = running.project_name ? ` · ${esc(running.project_name)}` : "";
    return `<div class="md-card tracking" id="timer-card">
      <div class="timer-state-label">TRACKING${proj}</div>
      <div class="md-title-medium">${running.description ? esc(running.description) : "No description"}</div>
      <div class="timer-elapsed" id="elapsed" data-start="${esc(running.start_time)}">…</div>
      <button class="md-extended-fab stop" hx-post="/timer/stop" hx-target="#timer-card" hx-swap="outerHTML">
        <span class="fab-icon" aria-hidden="true">■</span>Stop
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
    <form hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML" class="start-form">
      <div class="md-text-field grow">
        <input type="text" name="description" placeholder=" " autocomplete="off" aria-label="What are you working on?">
        <label>What are you working on?</label>
      </div>
      <div class="md-text-field shrink filled">
        <select name="project_id" aria-label="Project"><option value="">No project</option>${projectOptions()}</select>
        <label>Project</label>
      </div>
      <button class="md-extended-fab" type="submit">
        <span class="fab-icon" aria-hidden="true">▶</span>Start
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
    <div hx-get="/partial/timer" hx-trigger="load" hx-swap="outerHTML"><div class="md-card"><p class="muted">Loading…</p></div></div>
    <h2 class="md-headline-small">Today</h2>
    <div id="today-list" hx-get="/partial/today" hx-trigger="load, timer-updated from:body"></div>
    <h2 class="md-headline-small rev-heading">Revenue</h2>
    ${revenueCards()}`, "timer");
}

/** A1: revenue stat cards (invoiced / paid / outstanding). */
function revenueCards(): string {
  const t = revenueTotals();
  if (t.invoiced === 0) return `<p class="muted">No invoices yet — revenue will show up here.</p>`;
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

function weekGrid(weekStr?: string): string {
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

  const toMin = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
  const toHM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

  let weekTotal = 0;
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(mon, i);
    const [y, m, d] = day.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const wd = dt.toLocaleDateString([], { weekday: "short" });
    const entries = byDay.get(day) ?? [];
    const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
    weekTotal += total;
    const isToday = day === today;

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
      const color = e.client_color || "#f2c14e";
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
    days.push(`<div class="cal-day${isToday ? " today" : ""}">
      <div class="cal-day-head">
        <div class="md-label-large muted">${esc(wd)}</div>
        <div class="cal-day-num${isToday ? " today" : ""}">${d}</div>
        <div class="tiny muted">${fmtDur(total)}</div>
      </div>
      <div class="cal-day-col" data-date="${day}">${entryHtml}${nowLine}</div>
    </div>`);
  }

  const hourLabels = Array.from({ length: 24 }, (_, h) => {
    const ampm = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
    return `<span class="cal-hour-label" style="top:${(h * CAL_HOUR_PX - 8).toFixed(0)}px">${ampm}</span>`;
  }).join("");

  return `<div id="week">
    <div class="week-nav">
      <a class="md-text-button" href="/calendar?week=${prev}">← Prev</a>
      <h2 class="md-headline-small">${isThisWeek ? "This week" : `Week of ${esc(mon)}`} <span class="muted">· ${fmtDur(weekTotal)}</span></h2>
      <a class="md-text-button" href="/calendar?week=${next}">Next →</a>
    </div>
    <p class="muted tiny cal-hint">Drag on the grid to log time. Click an entry to edit it.</p>
    <div class="cal-scroll">
      <div class="cal-grid" id="cal-body" style="--cal-hour:${CAL_HOUR_PX}px">
        <div class="cal-gutter-col">
          <div class="cal-gutter-spacer"></div>
          <div class="cal-gutter cal-hours">${hourLabels}</div>
        </div>
        ${days.join("")}
      </div>
    </div>
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
  </div>`;
}

/** Inline script: drag-to-create, click-to-edit, now-line ticking. No htmx needed. */
function calScript(): string {
  return `(function(){
  var HOUR=${CAL_HOUR_PX};
  var body=document.getElementById('cal-body');
  var scrim=document.getElementById('cal-scrim');
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
    scrim.hidden=false; desc.focus();
  }
  function openEdit(el){
    mode='edit'; editId=el.dataset.id; dayStr=el.dataset.date;
    title.textContent='Edit entry'; delBtn.hidden=false; err.hidden=true;
    var d=new Date(dayStr+'T12:00:00');
    dateLine.textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
    desc.value=el.dataset.desc||''; project.value=el.dataset.projectId||'';
    startI.value=el.dataset.start||'09:00'; endI.value=el.dataset.end||toHM(toMin(startI.value)+60); updDur();
    scrim.hidden=false; desc.focus();
  }
  function close(){ scrim.hidden=true; }
  document.getElementById('cal-cancel').addEventListener('click',close);
  scrim.addEventListener('click',function(e){ if(e.target===scrim) close(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&!scrim.hidden) close(); });
  function fail(msg){ err.textContent=msg; err.hidden=false; }
  document.getElementById('cal-save').addEventListener('click',function(){
    var s=toMin(startI.value),e=toMin(endI.value);
    if(!(e>s)) return fail('End time must be after start time.');
    var fd=new URLSearchParams();
    fd.set('description',desc.value);
    fd.set('project_id',project.value);
    fd.set('start_time',dayStr+'T'+startI.value);
    fd.set('end_time',dayStr+'T'+endI.value);
    var url=mode==='create'?'/entries':'/entries/'+editId;
    fetch(url,{method:'POST',body:fd}).then(function(r){
      if(!r.ok) throw new Error('save failed');
      location.reload();
    }).catch(function(ex){ fail(ex.message); });
  });
  delBtn.addEventListener('click',function(){
    if(!confirm('Delete this entry?')) return;
    fetch('/entries/'+editId,{method:'DELETE'}).then(function(){ location.reload(); });
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
  body.addEventListener('pointerdown',function(e){
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
  return layout("Calendar", weekGrid(week), "calendar");
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
    <h2 class="md-headline-small">Edit entry</h2>
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
    <div class="two-col">
      <section>
        <h2 class="md-headline-small">Clients</h2>
        <form method="post" action="/clients" class="inline-form">
          <div class="md-text-field grow">
            <input type="text" name="name" placeholder=" " required aria-label="Client name">
            <label>Client name</label>
          </div>
          <div class="md-text-field shrink filled" style="max-width:110px">
            <input type="number" name="rate" min="0" step="0.01" placeholder=" " aria-label="Hourly rate">
            <label>$/hr</label>
          </div>
          <div class="md-color-field" title="Client color">
            <input type="color" name="color" value="#f2c14e" aria-label="Client color">
          </div>
          <button class="md-tonal-button" type="submit">Add</button>
        </form>
        ${clients.length ? `<ul class="md-list">${clients.map(c => `<li class="md-list-item" style="min-height:56px">
            <div class="md-list-item-content"><div class="md-list-item-headline"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(c.color)};margin-right:8px"></span>${esc(c.name)}</div></div>
            <div class="md-list-item-trailing">
              <form method="post" action="/clients/${c.id}/rate" class="inline rate-form" title="Hourly rate">
                <span class="muted tiny">$</span><input type="number" name="rate" value="${c.rate || ""}" min="0" step="0.01" placeholder="0" aria-label="Hourly rate for ${esc(c.name)}" class="rate-input"><span class="muted tiny">/hr</span>
                <button class="md-text-button" type="submit">Save</button>
              </form>
              <form method="post" action="/clients/${c.id}/delete" class="inline"><button class="md-icon-button danger" hx-confirm="Delete client? Projects keep their entries." aria-label="Delete client ${esc(c.name)}" title="Delete">🗑</button></form>
            </div>
          </li>`).join("")}</ul>` : `<p class="muted">No clients yet.</p>`}
      </section>
      <section>
        <h2 class="md-headline-small">Projects</h2>
        <form method="post" action="/projects" class="inline-form">
          <div class="md-text-field grow">
            <input type="text" name="name" placeholder=" " required aria-label="Project name">
            <label>Project name</label>
          </div>
          <div class="md-text-field shrink filled">
            <select name="client_id" aria-label="Client"><option value="">No client</option>
              ${clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
            <label>Client</label>
          </div>
          <button class="md-tonal-button" type="submit">Add</button>
        </form>
        ${projects.length ? `<ul class="md-list">${projects.map(p => `<li class="md-list-item" style="min-height:56px">
            <div class="md-list-item-content">
              <div class="md-list-item-headline">${p.client_color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(p.client_color)};margin-right:8px"></span>` : ""}${esc(p.name)}</div>
              ${p.client_name ? `<div class="md-list-item-supporting">${esc(p.client_name)}</div>` : ""}
            </div>
            <div class="md-list-item-trailing">
              <form method="post" action="/projects/${p.id}/delete" class="inline"><button class="md-icon-button danger" hx-confirm="Delete project? Entries keep their history." aria-label="Delete project ${esc(p.name)}" title="Delete">🗑</button></form>
            </div>
          </li>`).join("")}</ul>` : `<p class="muted">No projects yet.</p>`}
      </section>
    </div>`, "manage");
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
    <div class="page-head">
      <h2 class="md-headline-small">Invoices</h2>
      <a class="md-filled-button" href="/invoices/new">+ New invoice</a>
    </div>
    ${rows.length ? `<p class="muted">Outstanding: <strong>${money(outstanding)}</strong></p>` : ""}
    ${list}`, "invoices");
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
    <div class="md-card">
      <h3 class="md-title-medium">1 · Pick unbilled time</h3>
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
        <p class="muted tiny">Only finished, unbilled entries on this client's projects are included. Client hourly rates can be set on the Clients &amp; projects page.</p>
        <div class="row"><button class="md-filled-button" type="submit">Preview line items</button></div>
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
      step2 = `<div class="md-card"><h3 class="md-title-medium">2 · Line items</h3><p class="muted">${esc(preview.emptyMsg)}</p></div>`;
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
      <div class="md-card">
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
          <div class="row"><button class="md-filled-button" type="submit">Create invoice</button></div>
        </form>
      </div>`;
    }
  }

  return layout("New invoice", `
    <div class="page-head">
      <h2 class="md-headline-small">New invoice</h2>
      <a class="md-text-button" href="/invoices">Cancel</a>
    </div>
    ${step1}${step2}`, "invoices");
}

/** /invoices/:id — printable detail with status actions. */
function invoiceDetailPage(inv: Invoice & { items: InvoiceItem[] }): string {
  const t = invoiceTotals(inv.items, inv.tax_rate);
  const items = inv.items.map(it => `
    <tr>
      <td>${esc(it.description)}</td>
      <td class="num">${it.hours}</td>
      <td class="num">${money(it.rate)}</td>
      <td class="num">${money(it.amount)}</td>
    </tr>`).join("");
  const next = inv.status === "draft" ? "sent" : inv.status === "sent" ? "paid" : null;
  const nextLabel = next === "sent" ? "Mark sent" : next === "paid" ? "Mark paid" : "";
  return layout(`Invoice ${inv.number}`, `
    <div class="page-head no-print">
      <a class="md-text-button" href="/invoices">← Invoices</a>
      <div class="row">
        <a class="md-filled-button" href="/invoices/${inv.id}.pdf" download>Download PDF</a>
        ${next ? `<form method="post" action="/invoices/${inv.id}/status" class="inline">
          <input type="hidden" name="status" value="${next}">
          <button class="md-filled-button" type="submit">${nextLabel}</button>
        </form>` : ""}
        ${inv.status === "draft" ? `<form method="post" action="/invoices/${inv.id}/delete" class="inline">
          <button class="md-text-button danger" hx-confirm="Delete this draft invoice? Its entries become unbilled again.">Delete</button>
        </form>` : ""}
      </div>
    </div>
    <div class="md-card invoice-sheet">
      <div class="inv-head">
        <div>
          <div class="md-headline-small">Invoice ${esc(inv.number)}</div>
          <div class="muted">${inv.client_name ? esc(inv.client_name) : "<em>No client</em>"}</div>
        </div>
        <div class="inv-meta">${statusPill(inv.status)}</div>
      </div>
      <div class="inv-dates">
        <div><span class="muted">Issued</span><br><strong>${esc(inv.issue_date)}</strong></div>
        ${inv.due_date ? `<div><span class="muted">Due</span><br><strong>${esc(inv.due_date)}</strong></div>` : ""}
      </div>
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
    </div>`, "invoices");
}

function loginPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in · Timekeep</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/static/style.css"></head>
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
      if (!(await f.exists())) return new Response("Not found", { status: 404 });
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

    /* ---- JSON API ---- */
    if (path.startsWith("/api/")) {
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
          const want = String(body.status || "");
          const ok = (inv.status === "draft" && want === "sent") ||
                     (inv.status === "sent" && want === "paid");
          if (!ok) return json({ error: "invalid status transition (draft → sent → paid)" }, 400);
          db.query("UPDATE invoices SET status = ? WHERE id = ?").run(want, id);
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
      /* ---- revenue API (milestone 1) ---- */
      if (path === "/api/revenue" && method === "GET") return json({ totals: revenueTotals() });
      return json({ error: "not found" }, 404);
    }

    /* ---- pages ---- */
    if (!authedPage(req)) {
      return new Response(null, { status: 302, headers: { Location: "/login" } });
    }

    if (path === "/" && method === "GET") return html(dashboardPage());
    if (path === "/partial/timer" && method === "GET") return html(timerPartial());
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
      db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, ?, ?, ?)")
        .run(
          pid ? Number(pid) : null,
          String(form.get("description") || ""),
          new Date(String(form.get("start_time"))).toISOString(),
          endRaw ? new Date(endRaw).toISOString() : null);
      return json({ ok: true }, 201);
    }

    let m = path.match(/^\/entries\/(\d+)\/edit$/);
    if (m && method === "GET") {
      const page = editPage(Number(m[1]));
      return page ? html(page) : new Response("Not found", { status: 404 });
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
      return inv ? html(invoiceDetailPage(inv)) : new Response("Not found", { status: 404 });
    }
    m = path.match(/^\/invoices\/(\d+)\.pdf$/);
    if (m && method === "GET") {
      const inv = getInvoice(Number(m[1]));
      if (!inv) return new Response("Not found", { status: 404 });
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
      });
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
    m = path.match(/^\/invoices\/(\d+)\/delete$/);
    if (m && method === "POST") {
      const inv = qInvoice.get(Number(m[1])) as Invoice | null;
      if (!inv) return new Response("Not found", { status: 404 });
      if (inv.status !== "draft") return new Response("Only draft invoices can be deleted.", { status: 400 });
      db.transaction(() => {
        db.query("UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?").run(inv.id);
        db.query("DELETE FROM invoices WHERE id = ?").run(inv.id);
      })();
      return new Response(null, { status: 302, headers: { Location: "/invoices" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  ⏱ Timekeep running → http://localhost:${PORT}\n`);
