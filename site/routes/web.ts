/** Web routes: static files, login/logout, public invoice + portal pages,
 *  and every authenticated page and form action (timer, calendar, manage,
 *  invoices, estimates, recurring, CSV export, backup, demo data).
 *  Returns null when nothing matched so the caller can fall through. */

import { join, normalize, sep } from "node:path";
import type { Database, Statement } from "bun:sqlite";
import { addDays, esc, round2, todayStr } from "../lib/format.ts";
import type { Entry, Invoice, InvoiceItem } from "../lib/types.ts";
import type { PdfInvoice } from "../pdf.ts";

export interface WebDeps {
  db: Database;
  qRunning: Statement;
  qOne: Statement;
  qRange: Statement;
  qInvoice: Statement;
  qInvoices: Statement;
  qSchedules: Statement;
  DATA_DIR: string;
  STATIC_DIR: string;
  TOKEN: string;
  authedPage: (req: Request, token: string) => boolean;
  tokensEqual: (a: string, b: string) => boolean;
  html: (body: string, status?: number, extra?: Record<string, string>) => Response;
  json: (data: unknown, status?: number) => Response;
  isHtmx: (req: Request) => boolean;
  csvResponse: (filename: string, rows: string[][]) => Response;
  publicOrigin: (req: Request, port: number) => string;
  PORT: number;
  loginPage: () => string;
  publicInvoicePage: (inv: Invoice & { items: InvoiceItem[] }) => string;
  portalPage: (client: any) => string;
  notFoundPage: (authed: boolean) => string;
  errorPage: (authed: boolean) => string;
  dashboardPage: () => string;
  timerPartial: () => string;
  todayPartial: () => string;
  weekInner: (weekStr?: string) => string;
  recurringSection: () => string;
  calendarPage: (week?: string) => string;
  editPage: (id: number) => string | null;
  manageCols: () => string;
  managePage: () => string;
  invoicesPage: () => string;
  invoiceNewPage: (p: any, preview?: any) => string;
  defaultNewInvParams: () => any;
  invoiceStep2: (p: any, preview?: any) => string;
  invoiceDetailPage: (inv: Invoice & { items: InvoiceItem[] }, origin: string) => string;
  invoiceDetailBody: (inv: Invoice & { items: InvoiceItem[] }, origin: string) => string;
  invoiceDoc: (inv: Invoice & { items: InvoiceItem[] }) => string;
  estimatesPage: () => string;
  estimateNewPage: () => string;
  estimateDetailPage: (e: any) => string;
  getInvoice: (id: number) => (Invoice & { items: InvoiceItem[] }) | null;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  nextInvoiceNumber: () => string;
  nextEstimateNumber: () => string;
  stripeLinkFor: (id: number) => Promise<{ url?: string; error?: string; status?: number }>;
  unbilledEntries: (clientId: number, from: string, to: string) => any[];
  clientRounding: (clientId: number) => number | null;
  groupToLineItems: (entries: any[], rate: number, roundingMin?: number | null) => any[];
  ensurePublicToken: (id: number) => string;
  getPublicToken: (id: number) => string | null;
  mintPublicToken: (id: number) => string;
  getPortalToken: (clientId: number) => string | null;
  ensurePortalToken: (clientId: number) => string;
  invoicePdf: (inv: PdfInvoice) => Uint8Array;
  isInvoiceTemplate: (t: string) => boolean;
  stripeConfigured: () => boolean;
  workspaceEmpty: (db: Database) => boolean;
  demoIds: (db: Database) => number[];
  seedDemoData: (db: Database) => void;
  removeDemoData: (db: Database) => void;
  entryToJson: (e: Entry) => any;
  firstRun: (frequency: string, dayOfMonth: number, anchor?: string) => string;
  advanceRun: (s: any) => string;
  periodStart: (s: any) => string;
}

export function createWebRouter(deps: WebDeps) {
  const {
    db, qRunning, qOne, qRange, qInvoice, qInvoices, qSchedules,
    DATA_DIR, STATIC_DIR, TOKEN, authedPage, tokensEqual, html, json, csvResponse, isHtmx,
    publicOrigin, PORT, loginPage, publicInvoicePage, portalPage, notFoundPage, errorPage,
    dashboardPage, timerPartial, todayPartial, weekInner, recurringSection,
    calendarPage, editPage, manageCols, managePage, invoicesPage, invoiceNewPage,
    defaultNewInvParams, invoiceStep2, invoiceDetailPage, invoiceDetailBody, invoiceDoc,
    estimatesPage, estimateNewPage, estimateDetailPage, getInvoice, invoiceTotals,
    nextInvoiceNumber, nextEstimateNumber, stripeLinkFor, unbilledEntries, clientRounding,
    groupToLineItems, ensurePublicToken, getPublicToken, mintPublicToken, getPortalToken,
    ensurePortalToken, invoicePdf, isInvoiceTemplate, stripeConfigured,
    workspaceEmpty, demoIds, seedDemoData, removeDemoData, entryToJson,
    firstRun, advanceRun, periodStart,
  } = deps;

  /** Estimate with items + total, or null. Web-only helper. */
  function getEstimate(id: number): any | null {
    const e = db.query(`SELECT e.*, c.name AS client_name FROM estimates e
      LEFT JOIN clients c ON c.id = e.client_id WHERE e.id = ?`).get(id) as any;
    if (!e) return null;
    e.items = db.query("SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY id").all(id);
    e.total = (e.items as any[]).reduce((a, it) => a + Number(it.amount || 0), 0);
    return e;
  }

  /** Serve a web request, or null when the path is not a web route. */
  async function handleWeb(req: Request, url: URL, path: string, method: string): Promise<Response | null> {
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

        /* ---- JSON API is handled by routes/api.ts via handleApi; web routes continue below. ---- */

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

    return null;
  }

  return { handleWeb };
}
