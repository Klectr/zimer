/** Web routes: static files, login/logout, public invoice pages,
 *  and every authenticated page and form action (timer, calendar, manage,
 *  invoices, CSV export, backup, demo data).
 *  Returns null when nothing matched so the caller can fall through. */

import { join, normalize, sep } from "node:path";
import type { Database, Statement } from "bun:sqlite";
import { addDays, esc, round2, todayStr } from "../lib/format.ts";
import type { Entry, Invoice, InvoiceItem } from "../lib/types.ts";
import type { PdfInvoice } from "../pdf.ts";
import { getMeta, setMeta } from "../db.ts";

export interface WebDeps {
  db: Database;
  qRunning: Statement;
  qOne: Statement;
  qRange: Statement;
  qInvoice: Statement;
  qInvoices: Statement;
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
  notFoundPage: (authed: boolean) => string;
  errorPage: (authed: boolean) => string;
  dashboardPage: () => string;
  timerPartial: () => string;
  todayPartial: () => string;
  weekInner: (weekStr?: string) => string;
  calendarPage: (week?: string) => string;
  editPage: (id: number) => string | null;
  manageCols: () => string;
  managePage: () => string;
  bizProfileSection: () => string;
  invoicesPage: () => string;
  invoiceNewPage: (p: any, preview?: any) => string;
  defaultNewInvParams: () => any;
  invoiceStep2: (p: any, preview?: any) => string;
  invoiceDetailPage: (inv: Invoice & { items: InvoiceItem[] }, origin: string) => string;
  invoiceDetailBody: (inv: Invoice & { items: InvoiceItem[] }, origin: string) => string;
  invoiceDoc: (inv: Invoice & { items: InvoiceItem[] }) => string;
  getInvoice: (id: number) => (Invoice & { items: InvoiceItem[] }) | null;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  nextInvoiceNumber: () => string;
  stripeLinkFor: (id: number) => Promise<{ url?: string; error?: string; status?: number }>;
  unbilledEntries: (clientId: number, from: string, to: string) => any[];
  groupToLineItems: (entries: any[], rate: number) => any[];
  ensurePublicToken: (id: number) => string;
  getPublicToken: (id: number) => string | null;
  mintPublicToken: (id: number) => string;
  invoicePdf: (inv: PdfInvoice) => Uint8Array;
  stripeConfigured: () => boolean;
  workspaceEmpty: (db: Database) => boolean;
  demoIds: (db: Database) => number[];
  seedDemoData: (db: Database) => void;
  removeDemoData: (db: Database) => void;
  entryToJson: (e: Entry) => any;
}

export function createWebRouter(deps: WebDeps) {
  const {
    db, qRunning, qOne, qRange, qInvoice, qInvoices,
    DATA_DIR, STATIC_DIR, TOKEN, authedPage, tokensEqual, html, json, csvResponse, isHtmx,
    publicOrigin, PORT, loginPage, publicInvoicePage, notFoundPage, errorPage,
    dashboardPage, timerPartial, todayPartial, weekInner,
    calendarPage, editPage, manageCols, managePage, bizProfileSection, invoicesPage, invoiceNewPage,
    defaultNewInvParams, invoiceStep2, invoiceDetailPage, invoiceDetailBody, invoiceDoc,
    getInvoice, invoiceTotals,
    nextInvoiceNumber, stripeLinkFor, unbilledEntries,
    groupToLineItems, ensurePublicToken, getPublicToken, mintPublicToken,
    invoicePdf, stripeConfigured,
    workspaceEmpty, demoIds, seedDemoData, removeDemoData, entryToJson,
  } = deps;

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
        /* #233: business profile for the Modern PDF template's FROM block. */
        if (path === "/business-profile" && method === "POST") {
          const form = await req.formData();
          setMeta(db, "business_name", String(form.get("business_name") || "").trim());
          setMeta(db, "business_email", String(form.get("business_email") || "").trim());
          setMeta(db, "business_address", String(form.get("business_address") || "").trim());
          if (isHtmx(req)) return html(bizProfileSection());
          return new Response(null, { status: 302, headers: { Location: "/manage" } });
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
        m = path.match(/^\/projects\/(\d+)\/delete$/);
        if (m && method === "POST") {
          db.query("DELETE FROM projects WHERE id = ?").run(Number(m[1]));
          if (isHtmx(req)) return html(manageCols()); // #71: swap in place
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
          if (!p.client_id || !p.from || !p.to) {
            if (isHtmx(req)) return html(`<div class="md-card form-card"><p class="error">Pick a client and a date range first.</p></div>`, 400); // #71
            return html(invoiceNewPage(p), 400);
          }
          const entries = unbilledEntries(Number(p.client_id), p.from + "T00:00:00", p.to + "T00:00:00");
          const preview = !entries.length
            ? { items: [], emptyMsg: "No unbilled, finished entries on this client's projects in that range." }
            : { items: groupToLineItems(entries, Number(p.rate) || 0), rounding: 5 };
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
          mintPublicToken(inv.id); /* #227: client link exists from birth */
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
            fromName: getMeta(db, "business_name") || undefined,
            fromEmail: getMeta(db, "business_email") || undefined,
            fromAddress: getMeta(db, "business_address") || undefined,
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
          db.query(want === "paid"
            ? "UPDATE invoices SET status = 'paid', paid_at = date('now') WHERE id = ?"
            : "UPDATE invoices SET status = ? WHERE id = ?").run(...(want === "paid" ? [inv!.id] : [want, inv!.id]));
          /* #227: a sent invoice collects by default — create the Stripe payment
             link now. A Stripe failure never blocks the status transition; the
             detail page offers a retry. */
          if (want === "sent" && stripeConfigured()) { await stripeLinkFor(inv!.id); }
          if (isHtmx(req)) { const full = getInvoice(inv!.id); if (full) return html(invoiceDetailBody(full, publicOrigin(req, PORT))); } // #71
          return new Response(null, { status: 302, headers: { Location: `/invoices/${inv!.id}` } });
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
