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
  color TEXT NOT NULL DEFAULT '#7c8aff'
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
`);

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
function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Timekeep</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<nav>
  <a href="/" class="brand">⏱ Timekeep</a>
  <a href="/">Timer</a>
  <a href="/calendar">Calendar</a>
  <a href="/manage">Clients &amp; Projects</a>
  <a href="/logout" class="right">Log out</a>
</nav>
<main>${body}</main>
</body>
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
  const when = e.end_time ? `${fmtTime(e.start_time)} – ${fmtTime(e.end_time)}` : `${fmtTime(e.start_time)} – …`;
  const dot = e.client_color ? `<span class="dot" style="background:${esc(e.client_color)}"></span>` : "";
  const proj = e.project_name ? `<span class="proj">${dot}${esc(e.project_name)}${e.client_name ? ` · ${esc(e.client_name)}` : ""}</span>` : "";
  const desc = e.description ? esc(e.description) : "<em>No description</em>";
  return `<div class="entry" id="entry-${e.id}">
    <div class="entry-main">
      <div class="entry-desc">${desc}</div>
      <div class="entry-meta">${proj}<span class="when">${esc(when)}</span></div>
    </div>
    <div class="entry-right">
      <span class="dur">${dur}</span>
      <a class="btn small" href="/entries/${e.id}/edit">Edit</a>
      <button class="btn small danger" hx-delete="/entries/${e.id}"
        hx-target="#entry-${e.id}" hx-swap="outerHTML" hx-confirm="Delete this entry?">✕</button>
    </div>
  </div>`;
}

/** Timer card: running entry with live ticking, or the start form. */
function timerPartial(): string {
  const running = qRunning.get() as Entry | null;
  if (running) {
    const proj = running.project_name ? ` · ${esc(running.project_name)}` : "";
    return `<div class="card running" id="timer-card">
      <div class="timer-label">TRACKING${proj}</div>
      <div class="timer-desc">${running.description ? esc(running.description) : "<em>No description</em>"}</div>
      <div class="timer-elapsed" id="elapsed" data-start="${esc(running.start_time)}">…</div>
      <button class="btn stop" hx-post="/timer/stop" hx-target="#timer-card" hx-swap="outerHTML">Stop</button>
      <script>(function(){var el=document.getElementById('elapsed');if(!el)return;
        var s=new Date(el.dataset.start).getTime();
        function tick(){var d=Math.max(0,Date.now()-s);
          var h=Math.floor(d/36e5),m=Math.floor(d%36e5/6e4),sec=Math.floor(d%6e4/1e3);
          el.textContent=(h?h+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');}
        tick();setInterval(tick,1000);})();</script>
    </div>`;
  }
  return `<div class="card" id="timer-card">
    <div class="timer-label">NOT TRACKING</div>
    <form hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML" class="start-form">
      <input type="text" name="description" placeholder="What are you working on?" autocomplete="off">
      <select name="project_id"><option value="">No project</option>${projectOptions()}</select>
      <button class="btn start" type="submit">Start</button>
    </form>
  </div>`;
}

function todayPartial(): string {
  const [from, to] = dayBounds(todayStr());
  const entries = qRange.all(from, to) as Entry[];
  if (!entries.length) return `<p class="muted">Nothing tracked today yet.</p>`;
  const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
  return `<div class="day-total">Today: <strong>${fmtDur(total)}</strong></div>` +
    entries.map(entryRow).join("");
}

function dashboardPage(): string {
  return layout("Timer", `
    <div hx-get="/partial/timer" hx-trigger="load" hx-swap="outerHTML"><div class="card"><p class="muted">Loading…</p></div></div>
    <h2>Today</h2>
    <div id="today-list" hx-get="/partial/today" hx-trigger="load, timer-updated from:body"></div>`);
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

function weekPartial(weekStr?: string): string {
  const mon = mondayOf(weekStr);
  const prev = addDays(mon, -7), next = addDays(mon, 7);
  const isThisWeek = mon === mondayOf();
  let weekTotal = 0;
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(mon, i);
    const [from, to] = dayBounds(day);
    const entries = qRange.all(from, to) as Entry[];
    const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
    weekTotal += total;
    const [y, m, d] = day.split("-").map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
    cols.push(`<div class="day${day === todayStr() ? " today" : ""}">
      <div class="day-head">${esc(label)}<span class="day-total">${fmtDur(total)}</span></div>
      <div class="day-entries">${entries.map(entryRow).join("") || `<p class="muted tiny">—</p>`}</div>
    </div>`);
  }
  return `<div id="week">
    <div class="week-nav">
      <button class="btn small" hx-get="/partial/week?week=${prev}" hx-target="#week" hx-swap="outerHTML">← Prev</button>
      <h2>${isThisWeek ? "This week" : `Week of ${esc(mon)}`} <span class="muted">· ${fmtDur(weekTotal)}</span></h2>
      <button class="btn small" hx-get="/partial/week?week=${next}" hx-target="#week" hx-swap="outerHTML">Next →</button>
    </div>
    <div class="week-grid">${cols.join("")}</div>
  </div>`;
}

function calendarPage(week?: string): string {
  const q = week ? `?week=${esc(week)}` : "";
  return layout("Calendar",
    `<div hx-get="/partial/week${q}" hx-trigger="load" hx-swap="outerHTML"><p class="muted">Loading…</p></div>`);
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
    <h2>Edit entry</h2>
    <form method="post" action="/entries/${e.id}" class="form">
      <label>Description<input type="text" name="description" value="${esc(e.description)}"></label>
      <label>Project<select name="project_id"><option value="">No project</option>${projectOptions(e.project_id)}</select></label>
      <label>Start<input type="datetime-local" name="start_time" value="${toLocal(e.start_time)}" required></label>
      <label>End (blank = still running)<input type="datetime-local" name="end_time" value="${e.end_time ? toLocal(e.end_time) : ""}"></label>
      <div class="row">
        <button class="btn start" type="submit">Save</button>
        <a class="btn" href="/calendar">Cancel</a>
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
        <h2>Clients</h2>
        <form method="post" action="/clients" class="inline-form">
          <input type="text" name="name" placeholder="Client name" required>
          <input type="color" name="color" value="#7c8aff" title="Color">
          <button class="btn small" type="submit">Add</button>
        </form>
        ${clients.map(c => `<div class="row-item"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}
          <form method="post" action="/clients/${c.id}/delete" class="inline"><button class="btn small danger" hx-confirm="Delete client? Projects keep their entries.">✕</button></form></div>`).join("") || `<p class="muted">No clients yet.</p>`}
      </section>
      <section>
        <h2>Projects</h2>
        <form method="post" action="/projects" class="inline-form">
          <input type="text" name="name" placeholder="Project name" required>
          <select name="client_id"><option value="">No client</option>
            ${clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
          <button class="btn small" type="submit">Add</button>
        </form>
        ${projects.map(p => `<div class="row-item">${p.client_color ? `<span class="dot" style="background:${esc(p.client_color)}"></span>` : ""}${esc(p.name)}${p.client_name ? `<span class="muted"> · ${esc(p.client_name)}</span>` : ""}
          <form method="post" action="/projects/${p.id}/delete" class="inline"><button class="btn small danger" hx-confirm="Delete project? Entries keep their history.">✕</button></form></div>`).join("") || `<p class="muted">No projects yet.</p>`}
      </section>
    </div>`);
}

function loginPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in · Timekeep</title><link rel="stylesheet" href="/static/style.css"></head>
<body><main class="login"><h1>⏱ Timekeep</h1>
<form method="post" action="/login" class="form">
<label>API token<input type="password" name="token" autocomplete="off" required></label>
<button class="btn start" type="submit">Log in</button>
<p class="muted tiny">Printed in the server log on first run, or set via TIMEKEEP_TOKEN.</p>
</form></main></body></html>`;
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
        const r = db.query("INSERT INTO clients (name, color) VALUES (?, ?) RETURNING *")
          .get(String(body.name), String(body.color || "#7c8aff")) as any;
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
    if (path === "/partial/week" && method === "GET") return html(weekPartial(url.searchParams.get("week") || undefined));

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
      db.query("INSERT INTO clients (name, color) VALUES (?, ?)")
        .run(String(form.get("name")), String(form.get("color") || "#7c8aff"));
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

    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  ⏱ Timekeep running → http://localhost:${PORT}\n`);
