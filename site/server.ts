#!/usr/bin/env bun
/**
 * Timekeep site — Bun + HTMX + SQLite. Zero npm dependencies.
 *
 *   cd site && bun server.ts
 */

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve, normalize, sep } from "node:path";
import { invoicePdf, isInvoiceTemplate, templateList } from "./pdf.ts";
import { stripeConfigured, createPaymentLink, verifyWebhookSignature } from "./stripe.ts";
/* Milestone 20: modularization — leaf modules live in site/lib/. */
import type { Entry, Invoice, InvoiceItem, RevenueRow, NewInvParams } from "./lib/types.ts";
import { esc, fmtTime, fmtDate, durationSeconds, fmtDur, dayBounds, todayStr, entryToJson, round2, money, csvCell, csvResponse, statusPill, daysBetween, mondayOf, addDays, addMonths } from "./lib/format.ts";
import { ICONS, icon } from "./lib/icons.ts";
import { json, html, isHtmx, publicOrigin } from "./lib/http.ts";
import { getToken, tokensEqual, authedApi, authedPage } from "./lib/auth.ts";
import { createDb } from "./db.ts";
import { createRevenue } from "./lib/revenue.ts";
import { firstRun, advanceRun, periodStart } from "./lib/recurring.ts";
import { createBudgets } from "./lib/budgets.ts";
import { workspaceEmpty, demoIds, seedDemoData, removeDemoData, demoBanner } from "./lib/demo.ts";
import { createLayoutViews } from "./views/layout.ts";
import { createPublicViews } from "./views/public.ts";
import { createTimerViews } from "./views/timer.ts";
import { createCalendarViews } from "./views/calendar.ts";
import { createManageViews } from "./views/manage.ts";
import { createInvoiceViews } from "./views/invoices.ts";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dir, "data");
const STATIC_DIR = resolve(import.meta.dir, "static");
mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- token ---------------- */
/* Milestone 20: token minting + auth checks live in lib/auth.ts. */
const TOKEN = getToken(DATA_DIR);

/* ---------------- db ---------------- */
/* Milestone 20: database layer lives in site/db.ts — init, migrations, demo, prepared queries. */
const {
  db,
  ENTRY_SELECT,
  qRunning, qOne, qRange, qInvoice, qInvoiceItems, qInvoices, qSchedules, qRevenueRows,
} = createDb(DATA_DIR);

/* Milestone 20: revenue domain logic lives in lib/revenue.ts. */
const { revenueTotal, revenueTotals, revenueMonthly, revenueByClient, isOverdue, revenueOverdue } =
  createRevenue(qRevenueRows);

/* Milestone 20: budget helpers live in lib/budgets.ts. */
const { projectSpend, budgetStatus, budgetAlerts } = createBudgets(db);

/* Milestone 20: app chrome views live in views/layout.ts. */
const { layout, publicShell, notFoundPage, errorPage } = createLayoutViews(qRunning);

/* ---------------- invoicing helpers ---------------- */

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

/** Milestone 12: per-client portal token, minted on demand. */
function getPortalToken(clientId: number): string | null {
  return (db.query("SELECT portal_token FROM clients WHERE id = ?").get(clientId) as any)?.portal_token ?? null;
}
function ensurePortalToken(clientId: number): string {
  const existing = getPortalToken(clientId);
  if (existing) return existing;
  for (let i = 0; i < 5; i++) {
    const tok = newPublicToken();
    try {
      db.query("UPDATE clients SET portal_token = ? WHERE id = ?").run(tok, clientId);
      return tok;
    } catch { /* collision — retry */ }
  }
  throw new Error("could not mint portal token");
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

/* Milestone 20: publicOrigin lives in lib/http.ts. */



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

/* Milestone 20: revenue domain logic lives in lib/revenue.ts. */

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

/** Client's rounding rule in minutes, or null for exact billing. */
function clientRounding(clientId: number): number | null {
  const c = db.query("SELECT rounding_minutes FROM clients WHERE id = ?").get(clientId) as any;
  return c && c.rounding_minutes ? Number(c.rounding_minutes) : null;
}

/** Group entries by project into draft line items.
    roundingMin: per-entry round-up increment (Milestone 18); null/0 = exact. */
function groupToLineItems(entries: any[], rate: number, roundingMin?: number | null) {
  const groups = new Map<number, { project: string; ids: number[]; secs: number }>();
  for (const e of entries) {
    const g = groups.get(e.project_id) ?? { project: e.project_name, ids: [], secs: 0 };
    g.ids.push(e.id);
    g.secs += roundUpSeconds(durationSeconds(e.start_time, e.end_time), roundingMin);
    groups.set(e.project_id, g);
  }
  return [...groups.values()].map(g => {
    const hours = round2(g.secs / 3600);
    return { description: g.project, hours, rate, amount: round2(hours * rate), entry_ids: g.ids };
  });
}

/* Milestone 20: statusPill lives in lib/format.ts. */

/* Milestone 20: auth lives in lib/auth.ts. */

/* ---------------- views ---------------- */
function projectOptions(selected: number | null = null): string {
  const rows = db.query(
    `SELECT p.id, p.name, c.name AS client FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.name`).all() as any[];
  return rows.map(r =>
    `<option value="${r.id}"${r.id === selected ? " selected" : ""}>${esc(r.name)}${r.client ? ` (${esc(r.client)})` : ""}</option>`
  ).join("");
}










/* Milestone 20: mondayOf/addDays live in lib/format.ts. */

/** Pixels per hour in the calendar time grid. */
const CAL_HOUR_PX = 52;

/** Weekly hours target: 40h matches the ~80h biweekly invoicing pace.
    Kept as a constant in this slice; a configurable target is a follow-up. */
const WEEK_TARGET_SECS = 40 * 3600;

/** Daily hours target: 8h, matching the calendar's under-8h-day pacing (#22). */
const DAY_TARGET_SECS = 8 * 3600;

/** Shared M3 Expressive determinate progress track (#87). Under target: a
    wave-masked gold fill that ripples while motion is allowed, a tonal
    remainder track, and a small gold gap dot. At/over target: settles to a
    flat full-width gold fill with a one-pass completion sheen. `pct` is
    clamped 0..100; `met` selects the settled state. */
function m3ProgressBar(pct: number, met: boolean, ariaLabel: string): string {
  const bar = met
    ? `<div class="m3-progress-fill" style="width:${pct.toFixed(1)}%" aria-hidden="true"></div>`
    : `${pct > 0 ? `<div class="m3-progress-fill-wrap" style="width:calc((100% - 4px) * ${(pct / 100).toFixed(3)})" aria-hidden="true"><div class="m3-progress-fill-wave"></div></div>` : ""}
       <div class="m3-progress-remainder" aria-hidden="true"></div>
       <div class="m3-progress-dot" aria-hidden="true"></div>`;
  return `<div class="m3-progress-track${met ? " complete" : ""}" role="progressbar" aria-valuenow="${Math.round(pct)}"
      aria-valuemin="0" aria-valuemax="100" aria-label="${ariaLabel}">${bar}</div>`;
}

/** Milestone 20: timer page views live in views/timer.ts. */
const { entryRow, timerPartial, todayPartial, dashboardPage, revenueSection } = createTimerViews({
  db, qRunning, qRange, layout, demoBanner, budgetAlertCard, projectOptions,
  revenueTotals, revenueMonthly, revenueByClient, revenueOverdue, m3ProgressBar,
  dayTargetSecs: DAY_TARGET_SECS,
});

/** Milestone 20: calendar views live in views/calendar.ts. */
const { weekInner, weekGrid, calendarPage, editPage } = createCalendarViews({
  db, qOne, qRange, entrySelect: ENTRY_SELECT, layout, projectOptions, weekTargetBar,
  calHourPx: CAL_HOUR_PX,
});

/** Milestone 20: manage views live in views/manage.ts. */
const { manageCols, managePage, clientOptions, recurringNudge, recurringSection, recurringDialog } =
  createManageViews({ db, qSchedules, layout, projectSpend, budgetStatus });

/** Milestone 20: invoice views live in views/invoices.ts. */
const {
  invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2, invoiceSheet,
  invoiceDoc, invoiceDetailBody, invoiceDetailPage,
} = createInvoiceViews({
  db, qInvoices, layout, clientOptions, recurringNudge, recurringSection, recurringDialog,
  getPublicToken, stripeConfigured, nextInvoiceNumber, invoiceTotals, templateList, statusPill, isOverdue,
});

/** Slim pacing bar under the week header: tracked hours vs the 40h target. */
function weekTargetBar(weekTotalSecs: number): string {
  const pct = Math.min(100, (weekTotalSecs / WEEK_TARGET_SECS) * 100);
  const over = weekTotalSecs >= WEEK_TARGET_SECS;
  return `
    <div class="m3-progress week-target">
      ${m3ProgressBar(pct, over, "Weekly hours target, 40 hours")}
      <div class="md-label-medium muted m3-progress-label">${fmtDur(weekTotalSecs)} / 40h${over ? ` · <span class="tiny">over target</span>` : ""}</div>
    </div>`;
}











/** /invoices — list of invoices with status pills and totals. */
/* Milestone 18: round a duration UP to the next increment (per-entry billing).
   minutes <= 0 or null => no rounding. */
function roundUpSeconds(secs: number, minutes: number | null | undefined): number {
  const m = Number(minutes) || 0;
  if (m <= 0 || secs <= 0) return secs;
  const inc = m * 60;
  return Math.ceil(secs / inc) * inc;
}

function budgetAlertCard(): string {
  const alerts = budgetAlerts();
  if (!alerts.length) return "";
  const rows = alerts.map(({ p, spend, status }) => {
    const chip = status === "over"
      ? `<span class="attn-chip">Over budget</span>`
      : `<span class="warn-chip">80% of budget</span>`;
    const detail = p.budget_hours
      ? `${spend.hours}h of ${p.budget_hours}h`
      : `${money(spend.amount)} of ${money(p.budget_amount)}`;
    return `<li class="md-list-item"><div class="md-list-item-content">
        <div class="md-list-item-headline">${esc(p.name)} ${chip}</div>
        <div class="md-list-item-supporting">${p.client_name ? esc(p.client_name) + " · " : ""}${detail}</div>
      </div></li>`;
  }).join("");
  return `<div class="md-card rev-attention" data-enter="2">
    <div class="md-title-medium rev-chart-title">Budgets need attention</div>
    <ul class="md-list">${rows}</ul>
  </div>`;
}

/* Milestone 13: estimates. */
function nextEstimateNumber(): string {
  const n = (db.query("SELECT COUNT(*) AS n FROM estimates").get() as any).n + 1;
  return `EST-${String(n).padStart(3, "0")}`;
}
function getEstimate(id: number): any | null {
  const e = db.query(`SELECT e.*, c.name AS client_name FROM estimates e
    LEFT JOIN clients c ON c.id = e.client_id WHERE e.id = ?`).get(id) as any;
  if (!e) return null;
  e.items = db.query("SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY id").all(id);
  e.total = (e.items as any[]).reduce((a, it) => a + Number(it.amount || 0), 0);
  return e;
}
function estimatesPage(): string {
  const rows = db.query(`SELECT e.*, c.name AS client_name,
      (SELECT COALESCE(SUM(amount),0) FROM estimate_items WHERE estimate_id = e.id) AS total
    FROM estimates e LEFT JOIN clients c ON c.id = e.client_id ORDER BY e.id DESC`).all() as any[];
  const list = rows.length ? `<ul class="md-list">${rows.map(r => `<li class="md-list-item">
      <div class="md-list-item-content">
        <div class="md-list-item-headline"><a href="/estimates/${r.id}" class="inv-link">${esc(r.number)}</a> ${statusPill(r.status)}</div>
        <div class="md-list-item-supporting">${r.client_name ? esc(r.client_name) : "<em>No client</em>"} · issued ${esc(r.issue_date)}${r.valid_until ? ` · valid until ${esc(r.valid_until)}` : ""}</div>
      </div>
      <div class="md-list-item-trailing"><span class="dur">${money(r.total)}</span></div>
    </li>`).join("")}</ul>`
    : `<p class="muted">No estimates yet. Quote a client in seconds.</p>`;
  return layout("Estimates", `
    <div class="page-head" data-enter="2">
      <h2 class="md-headline-small">Estimates</h2>
      <a class="md-filled-button" href="/estimates/new">${icon("add")}New estimate</a>
    </div>
    <div class="scroll-region" data-enter="3">${list}</div>`, "estimates", true);
}
function estimateItemRow(): string {
  return `<div class="est-item-row">
    <div class="md-text-field filled grow"><input type="text" name="item_desc" placeholder=" " aria-label="Item description"><label>Description</label></div>
    <div class="md-text-field filled" style="max-width:110px"><input type="number" name="item_hours" min="0" step="0.25" placeholder=" " aria-label="Hours"><label>Hours</label></div>
    <div class="md-text-field filled has-prefix" style="max-width:130px"><span class="affix prefix" aria-hidden="true">$</span><input type="number" name="item_rate" min="0" step="0.01" placeholder=" " aria-label="Rate"><label>Rate</label></div>
    <button class="md-icon-button" type="button" title="Remove line" onclick="this.parentElement.remove()">${icon("delete")}</button>
  </div>`;
}
function estimateNewPage(): string {
  const t = todayStr();
  return layout("New estimate", `
    <div class="page-head" data-enter="2">
      <h2 class="md-headline-small">New estimate</h2>
      <a class="md-text-button" href="/estimates">Cancel</a>
    </div>
    <div class="scroll-region" data-enter="3">
    <form method="post" action="/estimates" class="form md-card form-card">
      <div class="two-field">
        <div class="md-text-field filled"><select name="client_id" aria-label="Client"><option value="">No client…</option>${clientOptions(null)}</select><label>Client</label></div>
        <div class="md-text-field filled"><input type="text" name="number" value="${nextEstimateNumber()}" required placeholder=" "><label>Estimate number</label></div>
      </div>
      <div class="two-field">
        <div class="md-text-field filled"><input type="date" name="issue_date" value="${t}" required placeholder=" "><label>Issue date</label></div>
        <div class="md-text-field filled"><input type="date" name="valid_until" value="${addDays(t, 30)}" placeholder=" "><label>Valid until</label></div>
      </div>
      <h3 class="md-title-medium">Line items</h3>
      <div id="est-items">${estimateItemRow()}</div>
      <div class="row"><button class="md-text-button" type="button" id="est-add">${icon("add")}Add line</button></div>
      <div class="md-text-field"><input type="text" name="notes" placeholder=" "><label>Notes (optional)</label></div>
      <div class="row end"><button class="md-filled-button" type="submit">${icon("check")}Create estimate</button></div>
    </form>
    </div>
    <script>(function(){
      var tpl = ${JSON.stringify(estimateItemRow())};
      document.getElementById('est-add').addEventListener('click', function(){
        document.getElementById('est-items').insertAdjacentHTML('beforeend', tpl);
      });
    })();</script>`, "estimates", true);
}
function estimateDetailPage(e: any): string {
  const items = (e.items as any[]).map(it => `<li class="md-list-item">
      <div class="md-list-item-content"><div class="md-list-item-headline">${esc(it.description)}</div>
      <div class="md-list-item-supporting">${Number(it.hours)}h × ${money(Number(it.rate))}</div></div>
      <div class="md-list-item-trailing"><span class="dur">${money(Number(it.amount))}</span></div>
    </li>`).join("");
  return layout(`Estimate ${esc(e.number)}`, `
    <div class="page-head" data-enter="2">
      <h2 class="md-headline-small">Estimate ${esc(e.number)}</h2>
      <a class="md-text-button" href="/estimates">Back</a>
    </div>
    <div class="scroll-region" data-enter="3">
      <div class="md-card form-card">
        <p class="md-title-medium">${e.client_name ? esc(e.client_name) : "<em>No client</em>"} ${statusPill(e.status)}</p>
        <p class="muted">Issued ${esc(e.issue_date)}${e.valid_until ? ` · valid until ${esc(e.valid_until)}` : ""}</p>
        ${e.notes ? `<p>${esc(e.notes)}</p>` : ""}
        <ul class="md-list">${items}</ul>
        <p class="md-title-large">Total: <strong>${money(e.total)}</strong></p>
        ${e.converted_invoice_id
          ? `<p><a class="md-text-button" href="/invoices/${e.converted_invoice_id}">View converted invoice</a></p>`
          : `<form method="post" action="/estimates/${e.id}/convert" class="inline"><button class="md-filled-button" type="submit">${icon("receipt")}Convert to invoice</button></form>`}
      </div>
    </div>`, "estimates", true);
}







/* Milestone 20: public views live in views/public.ts. */
const { loginPage, publicInvoicePage, portalPage } = createPublicViews({
  db, getInvoice, invoiceTotals, invoiceSheet, ensurePublicToken,
});





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
      if (!(await f.exists())) return html(notFoundPage(authedPage(req, TOKEN)), 404);
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
    /* Milestone 12: public per-client portal. Token is a credential — never
       logged, unknown tokens 404. */
    const portal = path.match(/^\/p\/([A-Za-z0-9_-]{16,64})$/);
    if (portal && method === "GET") {
      const c = db.query("SELECT * FROM clients WHERE portal_token = ?").get(portal[1]) as any;
      return c ? html(portalPage(c)) : html(notFoundPage(false), 404);
    }

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
              db.query("UPDATE invoices SET status = 'paid', paid_via_stripe = 1, paid_at = date('now') WHERE id = ?").run(invoiceId);
            }
          }
        }
        return json({ received: true });
      }
      try {
        if (!authedApi(req, TOKEN)) return json({ error: "unauthorized" }, 401);
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
              Number(body.rate) || 0, clientRounding(Number(body.client_id)));
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
          return json({ totals: revenueTotals(), by_month: revenueMonthly(), by_client: revenueByClient(), overdue: revenueOverdue() });
        return json({ error: "not found" }, 404);
      } catch (err) {
        console.error(`[timekeep] API ${method} ${path} threw:`, err);
        return json({ error: "internal" }, 500);
      }
    }

    /* ---- pages ---- */
    try {
      if (!authedPage(req, TOKEN)) {
        return new Response(null, { status: 302, headers: { Location: "/login" } });
      }

      if (path === "/" && method === "GET") return html(dashboardPage());
      if (path === "/partial/timer" && method === "GET") return html(timerPartial());
      if (path === "/partial/week" && method === "GET") {
        const w = new URL(req.url).searchParams.get("week") || undefined;
        return html(weekInner(w || undefined));
      }
      if (path === "/partial/today" && method === "GET") return html(todayPartial());
      /* Issue #140: in-place refresh of the recurring section after dialog submit. */
      if (path === "/partial/recurring" && method === "GET") return html(recurringSection());
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
        return page ? html(page) : html(notFoundPage(authedPage(req, TOKEN)), 404);
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

    if (path === "/demo/load" && method === "POST") {
      if (demoIds(db) || !workspaceEmpty(db)) return new Response("Workspace is not empty.", { status: 400 });
      seedDemoData(db);
      return new Response(null, { status: 302, headers: { Location: "/" } });
    }
    if (path === "/demo/reset" && method === "POST") {
      if (!demoIds(db)) return new Response("No demo data to remove.", { status: 400 });
      removeDemoData(db);
      return new Response(null, { status: 302, headers: { Location: "/" } });
    }

    /* Milestone 9: one-click database backup. Checkpoint WAL so the
       downloaded file contains the latest writes, then serve it with a
       timestamped filename. */
    if (path === "/backup" && method === "GET") {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      const dbPath = join(DATA_DIR, "timekeep.db");
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const bytes = await Bun.file(dbPath).bytes();
      return new Response(bytes, { status: 200, headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="timekeep-backup-${ts}.db"`,
      } });
    }

    /* Milestone 10: CSV exports — accountant-friendly columns, UTF-8 BOM so
       Excel detects the encoding. */
    if (path === "/export/entries.csv" && method === "GET") {
      const rows = db.query(`
        SELECT e.description, e.start_time, e.end_time,
               p.name AS project, c.name AS client, c.rate AS rate
        FROM time_entries e
        LEFT JOIN projects p ON p.id = e.project_id
        LEFT JOIN clients c ON c.id = p.client_id
        ORDER BY e.start_time`).all() as any[];
      const out = ["date,client,project,description,start,end,hours,billable,rate,amount"];
      for (const r of rows) {
        const start = new Date(r.start_time);
        const end = r.end_time ? new Date(r.end_time) : null;
        const hours = end ? (end.getTime() - start.getTime()) / 3600000 : 0;
        const billable = r.project ? "yes" : "no";
        const rate = Number(r.rate || 0);
        const amount = (hours * rate).toFixed(2);
        const cells = [
          start.toISOString().slice(0, 10), r.client || "", r.project || "",
          r.description || "", start.toISOString().slice(11, 16),
          end ? end.toISOString().slice(11, 16) : "",
          hours.toFixed(2), billable, rate.toFixed(2), amount,
        ];
        out.push(cells.map(csvCell).join(","));
      }
      return csvResponse(out.join("\n"), "timekeep-entries.csv");
    }

    if (path === "/export/invoices.csv" && method === "GET") {
      const rows = db.query(`
        SELECT i.number, i.issue_date, i.due_date, i.status, i.tax_rate,
               c.name AS client,
               (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) AS items,
               (SELECT COALESCE(SUM(amount), 0) FROM invoice_items WHERE invoice_id = i.id) AS subtotal
        FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
        ORDER BY i.issue_date DESC`).all() as any[];
      const out = ["number,client,issue_date,due_date,status,items,subtotal,tax,total"];
      for (const r of rows) {
        const subtotal = Number(r.subtotal || 0);
        const tax = subtotal * Number(r.tax_rate || 0) / 100;
        const cells = [r.number, r.client || "", r.issue_date, r.due_date || "",
          r.status, String(r.items), subtotal.toFixed(2), tax.toFixed(2),
          (subtotal + tax).toFixed(2)];
        out.push(cells.map(csvCell).join(","));
      }
      return csvResponse(out.join("\n"), "timekeep-invoices.csv");
    }

    if (path === "/manage" && method === "GET") return html(managePage());
    const pm = path.match(/^\/clients\/(\d+)\/portal-link$/);
    if (pm && method === "POST") {
      const id = Number(pm[1]);
      const c = db.query("SELECT id, name FROM clients WHERE id = ?").get(id) as any;
      if (!c) return new Response("Not found", { status: 404 });
      const url = `${publicOrigin(req, PORT)}/p/${ensurePortalToken(id)}`;
      const frag = `<span id="portal-link-${id}" class="portal-url"><input readonly value="${esc(url)}" onclick="this.select()" aria-label="Portal link for ${esc(c.name)}"><button class="md-icon-button" title="Copy link" onclick="navigator.clipboard.writeText('${esc(url)}')">${icon("copy")}</button></span>`;
      return isHtmx(req) ? html(frag) : new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    if (path === "/clients" && method === "POST") {
      const form = await req.formData();
      db.query("INSERT INTO clients (name, color, rate) VALUES (?, ?, ?)")
        .run(String(form.get("name")), String(form.get("color") || "#f2c14e"),
             Number(form.get("rate") || 0));
      if (isHtmx(req)) return html(manageCols()); // #71: swap in place
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    m = path.match(/^\/clients\/(\d+)\/rate$/);
    if (m && method === "POST") {
      const form = await req.formData();
      db.query("UPDATE clients SET rate = ? WHERE id = ?")
        .run(Number(form.get("rate") || 0), Number(m[1]));
      if (isHtmx(req)) return html(manageCols()); // #71: swap in place
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    m = path.match(/^\/clients\/(\d+)\/rounding$/);
    if (m && method === "POST") {
      const form = await req.formData();
      const mins = Number(form.get("rounding_minutes") || 0);
      db.query("UPDATE clients SET rounding_minutes = ? WHERE id = ?")
        .run(mins > 0 ? mins : null, Number(m[1]));
      if (isHtmx(req)) return html(manageCols());
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    m = path.match(/^\/clients\/(\d+)\/delete$/);
    if (m && method === "POST") {
      db.query("DELETE FROM clients WHERE id = ?").run(Number(m[1]));
      if (isHtmx(req)) return html(manageCols()); // #71: swap in place
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    if (path === "/projects" && method === "POST") {
      const form = await req.formData();
      const cid = form.get("client_id");
      db.query("INSERT INTO projects (name, client_id) VALUES (?, ?)")
        .run(String(form.get("name")), cid ? Number(cid) : null);
      if (isHtmx(req)) return html(manageCols()); // #71: swap in place
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    const pb = path.match(/^\/projects\/(\d+)\/budget$/);
    if (pb && method === "POST") {
      const form = await req.formData();
      const bh = Number(form.get("budget_hours") || 0), ba = Number(form.get("budget_amount") || 0);
      db.query("UPDATE projects SET budget_hours = ?, budget_amount = ? WHERE id = ?")
        .run(bh > 0 ? bh : null, ba > 0 ? ba : null, Number(pb[1]));
      if (isHtmx(req)) return html(manageCols());
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }
    m = path.match(/^\/projects\/(\d+)\/delete$/);
    if (m && method === "POST") {
      db.query("DELETE FROM projects WHERE id = ?").run(Number(m[1]));
      if (isHtmx(req)) return html(manageCols()); // #71: swap in place
      return new Response(null, { status: 302, headers: { Location: "/manage" } });
    }

    /* ---- invoicing pages ---- */
    /* Milestone 13: estimates. */
    if (path === "/estimates" && method === "GET") return html(estimatesPage());
    if (path === "/estimates/new" && method === "GET") return html(estimateNewPage());
    if (path === "/estimates" && method === "POST") {
      const form = await req.formData();
      const number = String(form.get("number") || nextEstimateNumber());
      if (db.query("SELECT 1 FROM estimates WHERE number = ?").get(number))
        return new Response("Estimate number already exists.", { status: 400 });
      const descs = form.getAll("item_desc").map(String);
      const hours = form.getAll("item_hours").map(Number);
      const rates = form.getAll("item_rate").map(Number);
      const items = descs.map((d, i) => ({
        description: d || "Item",
        hours: round2(hours[i] || 0),
        rate: round2(rates[i] || 0),
      })).filter(it => it.hours > 0).map(it => ({ ...it, amount: round2(it.hours * it.rate) }));
      if (!items.length) return new Response("Add at least one line item with hours.", { status: 400 });
      const cid = form.get("client_id");
      const id = Number(db.query(
        "INSERT INTO estimates (client_id, number, issue_date, valid_until, notes) VALUES (?, ?, ?, ?, ?)")
        .run(cid ? Number(cid) : null, number, String(form.get("issue_date") || todayStr()),
              String(form.get("valid_until") || "") || null, String(form.get("notes") || ""))
        .lastInsertRowid);
      const ins = db.query("INSERT INTO estimate_items (estimate_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)");
      for (const it of items) ins.run(id, it.description, it.hours, it.rate, it.amount);
      return new Response(null, { status: 302, headers: { Location: `/estimates/${id}` } });
    }
    const em = path.match(/^\/estimates\/(\d+)$/);
    if (em && method === "GET") {
      const e = getEstimate(Number(em[1]));
      return e ? html(estimateDetailPage(e)) : html(notFoundPage(authedPage(req, TOKEN)), 404);
    }
    /* Milestone 13.2: one-click estimate -> draft invoice conversion. */
    const cv = path.match(/^\/estimates\/(\d+)\/convert$/);
    if (cv && method === "POST") {
      const e = getEstimate(Number(cv[1]));
      if (!e) return new Response("Not found", { status: 404 });
      if (e.converted_invoice_id)
        return new Response(null, { status: 302, headers: { Location: `/invoices/${e.converted_invoice_id}` } });
      const inv = db.query(
        `INSERT INTO invoices (client_id, number, issue_date, due_date, tax_rate, notes)
         VALUES (?, ?, ?, ?, 0, ?) RETURNING id`)
        .get(e.client_id, nextInvoiceNumber(), todayStr(), addDays(todayStr(), 15),
             `Converted from estimate ${e.number}.${e.notes ? " " + e.notes : ""}`) as any;
      const insItem = db.query(
        "INSERT INTO invoice_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)");
      db.transaction(() => {
        for (const it of e.items as any[]) insItem.run(inv.id, it.description, it.hours, it.rate, it.amount);
      })();
      db.query("UPDATE estimates SET status = 'converted', converted_invoice_id = ? WHERE id = ?")
        .run(inv.id, e.id);
      return new Response(null, { status: 302, headers: { Location: `/invoices/${inv.id}` } });
    }

    if (path === "/invoices" && method === "GET") return html(invoicesPage());
      /* Milestone 8: recurring schedule CRUD (drafts only, never auto-sent). */
      if (path === "/recurring" && method === "POST") {
        const form = await req.formData();
        const clientId = Number(form.get("client_id") || 0);
        if (!clientId || !db.query("SELECT 1 FROM clients WHERE id = ?").get(clientId))
          return new Response("Pick a client.", { status: 400 });
        const frequency = String(form.get("frequency")) === "biweekly" ? "biweekly" : "monthly";
        const source = String(form.get("source")) === "fixed" ? "fixed" : "unbilled";
        const dayOfMonth = frequency === "monthly"
          ? Math.min(Math.max(Number(form.get("day_of_month") || 1), 1), 28) : null;
        const fixedAmount = source === "fixed" ? Math.max(Number(form.get("fixed_amount") || 0), 0) : 0;
        const anchor = todayStr();
        db.query(`INSERT INTO recurring_schedules
          (client_id, frequency, source, fixed_amount, day_of_month, anchor_date, next_run)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(clientId, frequency, source, fixedAmount, dayOfMonth, anchor,
               firstRun(frequency, dayOfMonth, anchor));
        /* Issue #140: the dialog submits via fetch — answer JSON like POST /entries.
           Native form posts (no-JS fallback) still get the 302. */
        if (req.headers.get("sec-fetch-mode") !== "navigate") return json({ ok: true }, 201);
        return new Response(null, { status: 302, headers: { Location: "/invoices#recurring" } });
      }
      m = path.match(/^\/recurring\/(\d+)\/(toggle|delete)$/);
      if (m && method === "POST") {
        const s = db.query("SELECT * FROM recurring_schedules WHERE id = ?").get(Number(m[1])) as any;
        if (!s) return new Response("Not found", { status: 404 });
        if (m[2] === "toggle") db.query("UPDATE recurring_schedules SET active = 1 - active WHERE id = ?").run(s.id);
        else db.query("DELETE FROM recurring_schedules WHERE id = ?").run(s.id);
        return new Response(null, { status: 302, headers: { Location: "/invoices#recurring" } });
      }
      /* Milestone 8.2: one-click draft from a schedule. Drafts only, never auto-sent. */
      m = path.match(/^\/recurring\/(\d+)\/generate$/);
      if (m && method === "POST") {
        const s = db.query(
          `SELECT s.*, c.rate AS client_rate FROM recurring_schedules s
           JOIN clients c ON c.id = s.client_id WHERE s.id = ?`).get(Number(m[1])) as any;
        if (!s) return new Response("Not found", { status: 404 });
        if (!s.active) return new Response("Schedule is paused.", { status: 400 });
        const from = periodStart(s), to = s.next_run;
        const items: { description: string; hours: number; rate: number; amount: number; entry_ids: number[] }[] = [];
        let notes = "";
        if (s.source === "fixed") {
          const label = s.frequency === "biweekly" ? "Biweekly retainer" : "Monthly retainer";
          items.push({ description: `${label} · ${from} – ${to}`, hours: 1, rate: s.fixed_amount, amount: round2(s.fixed_amount), entry_ids: [] });
        } else {
          const entries = unbilledEntries(s.client_id, from + "T00:00:00", to + "T00:00:00");
          items.push(...groupToLineItems(entries, s.client_rate || 0, clientRounding(s.client_id)));
          if (!items.length) notes = `No unbilled hours for ${from} to ${to}.`;
        }
        const inv = db.query(
          `INSERT INTO invoices (client_id, number, issue_date, due_date, tax_rate, notes)
           VALUES (?, ?, ?, ?, 0, ?) RETURNING id`)
          .get(s.client_id, nextInvoiceNumber(), todayStr(), addDays(todayStr(), 15), notes) as any;
        const insItem = db.query(
          "INSERT INTO invoice_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)");
        const linkEntry = db.query("UPDATE time_entries SET invoice_id = ? WHERE id = ?");
        db.transaction(() => {
          for (const it of items) {
            insItem.run(inv.id, it.description, it.hours, it.rate, it.amount);
            for (const eid of it.entry_ids) linkEntry.run(inv.id, eid);
          }
        })();
        db.query("UPDATE recurring_schedules SET next_run = ? WHERE id = ?").run(advanceRun(s), s.id);
        return new Response(null, { status: 302, headers: { Location: `/invoices/${inv.id}` } });
      }
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
      if (!p.client_id || !p.from || !p.to) {
        if (isHtmx(req)) return html(`<div class="md-card form-card"><p class="error">Pick a client and a date range first.</p></div>`, 400); // #71
        return html(invoiceNewPage(p), 400);
      }
      const entries = unbilledEntries(Number(p.client_id), p.from + "T00:00:00", p.to + "T00:00:00");
      const rounding = clientRounding(Number(p.client_id));
      const preview = !entries.length
        ? { items: [], emptyMsg: "No unbilled, finished entries on this client's projects in that range." }
        : { items: groupToLineItems(entries, Number(p.rate) || 0, rounding), rounding };
      if (isHtmx(req)) return html(invoiceStep2(p, preview)); // #71: swap step 2 in place
      return html(invoiceNewPage(p, preview));
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
      return inv ? html(invoiceDetailPage(inv, publicOrigin(req, PORT))) : html(notFoundPage(authedPage(req, TOKEN)), 404);
    }
    m = path.match(/^\/invoices\/(\d+)\.pdf$/);
    if (m && method === "GET") {
      const inv = getInvoice(Number(m[1]));
      if (!inv) return html(notFoundPage(authedPage(req, TOKEN)), 404);
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
      db.query(want === "paid"
        ? "UPDATE invoices SET status = 'paid', paid_at = date('now') WHERE id = ?"
        : "UPDATE invoices SET status = ? WHERE id = ?").run(...(want === "paid" ? [inv!.id] : [want, inv!.id]));
      if (isHtmx(req)) { const full = getInvoice(inv!.id); if (full) return html(invoiceDetailBody(full, publicOrigin(req, PORT))); } // #71
      return new Response(null, { status: 302, headers: { Location: `/invoices/${inv!.id}` } });
    }
    m = path.match(/^\/invoices\/(\d+)\/template$/);
    if (m && method === "POST") {
      const form = await req.formData();
      const tpl = String(form.get("template") || "");
      if (!isInvoiceTemplate(tpl)) return new Response("Unknown template.", { status: 400 });
      db.query("UPDATE invoices SET template = ? WHERE id = ?").run(tpl, Number(m[1]));
      const inv = getInvoice(Number(m[1]));
      return inv ? html(invoiceDoc(inv)) : html(notFoundPage(authedPage(req, TOKEN)), 404);
    }
    m = path.match(/^\/invoices\/(\d+)\/stripe-link$/);
    if (m && method === "POST") {
      const r = await stripeLinkFor(Number(m[1]));
      if (r.url) {
        if (isHtmx(req)) { const full = getInvoice(Number(m[1])); if (full) return html(invoiceDetailBody(full, publicOrigin(req, PORT))); } // #71
        return new Response(null, { status: 302, headers: { Location: `/invoices/${m[1]}` } });
      }
      return new Response(r.error || "Stripe error", { status: r.status || 500 });
    }
    m = path.match(/^\/invoices\/(\d+)\/public-token\/regenerate$/);
    if (m && method === "POST") {
      mintPublicToken(Number(m[1]));
      if (isHtmx(req)) { const full = getInvoice(Number(m[1])); if (full) return html(invoiceDetailBody(full, publicOrigin(req, PORT))); } // #71
      return new Response(null, { status: 302, headers: { Location: `/invoices/${m[1]}` } });
    }
    m = path.match(/^\/invoices\/(\d+)\/public-token\/revoke$/);
    if (m && method === "POST") {
      db.query("UPDATE invoices SET public_token = NULL WHERE id = ?").run(Number(m[1]));
      if (isHtmx(req)) { const full = getInvoice(Number(m[1])); if (full) return html(invoiceDetailBody(full, publicOrigin(req, PORT))); } // #71
      return new Response(null, { status: 302, headers: { Location: `/invoices/${m[1]}` } });
    }
    m = path.match(/^\/invoices\/(\d+)\/delete$/);
    if (m && method === "POST") {
      const inv = qInvoice.get(Number(m[1])) as Invoice | null;
      if (!inv) return html(notFoundPage(authedPage(req, TOKEN)), 404);
      if (inv.status !== "draft") return new Response("Only draft invoices can be deleted.", { status: 400 });
      db.transaction(() => {
        db.query("UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?").run(inv.id);
        db.query("DELETE FROM invoices WHERE id = ?").run(inv.id);
      })();
      return new Response(null, { status: 302, headers: { Location: "/invoices" } });
    }

      return html(notFoundPage(authedPage(req, TOKEN)), 404);
    } catch (err) {
      console.error(`[timekeep] page ${method} ${path} threw:`, err);
      return html(errorPage(authedPage(req, TOKEN)), 500);
    }
  },
});

console.log(`\n  ⏱ Timekeep running → http://localhost:${PORT}\n`);
