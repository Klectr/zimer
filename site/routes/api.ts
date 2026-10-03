/** JSON API routes: /api/* (timer, entries, clients, projects, invoices,
 *  revenue) plus the unauthenticated Stripe webhook. Returns null when the
 *  path is not an API path so the caller falls through to web routes. */

import type { Database, Statement } from "bun:sqlite";
import { entryIsLocked, round2, todayStr } from "../lib/format.ts";
import type { Entry, Invoice, InvoiceItem } from "../lib/types.ts";

/* #733: everything derived from one tenant's SQLite bundle. Resolved per
   request from the session (session → user → tenant tree, cached by user
   id); self-host resolves the single global bundle, so behavior there is
   unchanged. */
export interface ApiTenant {
  db: Database;
  qRunning: Statement;
  qOne: Statement;
  qRange: Statement;
  qInvoice: Statement;
  qInvoices: Statement;
  groupToLineItems: (groups: any[], rate: number) => any[];
  unbilledEntries: (clientId: number, from: string, to: string) => any[];
  getInvoice: (id: number) => (Invoice & { items: InvoiceItem[] }) | null;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  nextInvoiceNumber: () => string;
  mintPublicToken: (id: number) => string;
  stripeLinkFor: (id: number) => Promise<{ url?: string; error?: string; status?: number }>;
  revenueTotals: () => any;
  revenueMonthly: () => any[];
  revenueByClient: () => any[];
  revenueOverdue: () => any[];
  freezeInvoiceSnapshots: (id: number, origin: string) => void; /* #301 */
}

export interface ApiDeps {
  /* #733: per-request tenant resolution. Null = hosted mode with no session;
     self-host always returns the global tree. */
  getTenant: (req: Request) => ApiTenant | null;
  TOKEN: string;
  authedApi: (req: Request, token: string) => boolean;
  json: (data: unknown, status?: number) => Response;
  entryToJson: (e: Entry) => any;
  verifyWebhookSignature: (payload: string, sig: string | null, secret: string) => boolean;
  shareOrigin: (req: Request) => string; /* #301 */
}

export function createApiRouter(deps: ApiDeps) {
  const {
    getTenant, TOKEN, authedApi, json, entryToJson, verifyWebhookSignature, shareOrigin,
  } = deps;

  /** Serve a /api/* request, or null when the path is not an API route. */
  async function handleApi(req: Request, url: URL, path: string, method: string): Promise<Response | null> {
    if (!path.startsWith("/api/")) return null;
    /* #733: resolve the tenant up front — null means hosted mode with no
       session (the Stripe webhook is the only unauthenticated API route). */
    const tenant = getTenant(req);

          /* ---- Stripe webhook: no Bearer auth — verified by signature instead.
             Reads the raw body; signature is checked before any DB access. ---- */
          if (path === "/api/stripe/webhook" && method === "POST") {
            /* #733: webhooks carry no session, so there is no tenant to read
               — cross-tenant routing is a follow-up. Fail loud (Stripe
               retries) instead of silently dropping paid invoices. */
            if (!tenant) return json({ error: "multi-tenant webhook routing not configured" }, 503);
            const { db, qInvoice, freezeInvoiceSnapshots } = tenant;
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
              if (session.payment_status === "paid") {
                /* #645: metadata set on a Payment Link does NOT propagate to
                   the Checkout Session, so session.metadata.invoice_id is
                   empty on real payments. Match the link ID first (stored at
                   link creation); the metadata path stays as a fallback. */
                let invoiceId = 0;
                const pl = session.payment_link;
                const linkId = typeof pl === "string" ? pl : pl?.id;
                if (linkId) {
                  const row = db.query(
                    "SELECT id FROM invoices WHERE stripe_payment_link_id = ?"
                  ).get(linkId) as any;
                  invoiceId = Number(row?.id || 0);
                }
                if (!invoiceId) invoiceId = Number(session.metadata?.invoice_id || 0);
                if (invoiceId) {
                  const inv = qInvoice.get(invoiceId) as Invoice | null;
                  if (inv && inv.status === "sent") {
                    db.query("UPDATE invoices SET status = 'paid', paid_via_stripe = 1, paid_at = date('now') WHERE id = ?").run(invoiceId);
                    /* #301: re-freeze so the Paid badge is part of the record. */
                    freezeInvoiceSnapshots(invoiceId, shareOrigin(req));
                  }
                }
              }
            }
            return json({ received: true });
          }
          try {
            if (!authedApi(req, TOKEN)) return json({ error: "unauthorized" }, 401);
            /* #733: auth passed but no tenant — hosted mode, master Bearer
               token with no session. Tenant data needs a user session. */
            if (!tenant) return json({ error: "unauthorized" }, 401);
            const {
              db, qRunning, qOne, qRange, qInvoice, qInvoices,
              groupToLineItems, unbilledEntries, getInvoice,
              invoiceTotals, nextInvoiceNumber, mintPublicToken, stripeLinkFor,
              revenueTotals, revenueMonthly, revenueByClient, revenueOverdue,
              freezeInvoiceSnapshots,
            } = tenant;
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
                if (entryIsLocked(cur)) /* #334 */
                  return json({ error: "This time is invoiced and can't be edited." }, 403);
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
                const cur = qOne.get(id) as Entry | null; /* #334 */
                if (cur && entryIsLocked(cur))
                  return json({ error: "This time is invoiced and can't be deleted." }, 403);
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
              /* Schema FK actions are not enforced (no PRAGMA foreign_keys):
                 null these out explicitly so nothing dangles. */
              db.transaction(() => {
                db.query("UPDATE projects SET client_id = NULL WHERE client_id = ?").run(Number(m[1]));
                db.query("UPDATE invoices SET client_id = NULL WHERE client_id = ?").run(Number(m[1]));
                db.query("DELETE FROM clients WHERE id = ?").run(Number(m[1]));
              })();
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
              /* Schema FK is not enforced: null entries explicitly. */
              db.transaction(() => {
                db.query("UPDATE time_entries SET project_id = NULL WHERE project_id = ?").run(Number(m[1]));
                db.query("DELETE FROM projects WHERE id = ?").run(Number(m[1]));
              })();
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
                  /* #243: optional per-line billing dates */
                  date_from: typeof it.date_from === "string" && it.date_from ? it.date_from : null,
                  date_to: typeof it.date_to === "string" && it.date_to ? it.date_to : null,
                }))
                .filter(it => it.hours > 0);
              if (!clean.length) return json({ error: "no billable line items" }, 400);
              const inv = db.query(
                `INSERT INTO invoices (client_id, number, issue_date, due_date, tax_rate, notes, internal_notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
                .get(
                  body.client_id ? Number(body.client_id) : null,
                  number,
                  String(body.issue_date || todayStr()),
                  body.due_date ? String(body.due_date) : null,
                  Number(body.tax_rate) || 0,
                  String(body.notes || ""),
                  String(body.internal_notes || "")) as any; /* #302 */
              const insItem = db.query(
                "INSERT INTO invoice_items (invoice_id, description, hours, rate, amount, date_from, date_to) VALUES (?, ?, ?, ?, ?, ?, ?)");
              const linkEntry = db.query("UPDATE time_entries SET invoice_id = ? WHERE id = ?");
              db.transaction(() => {
                for (const it of clean) {
                  insItem.run(inv.id, it.description, it.hours, it.rate, round2(it.hours * it.rate), it.date_from, it.date_to);
                  for (const eid of it.entry_ids) linkEntry.run(inv.id, eid);
                }
              })();
              mintPublicToken(inv.id); /* #227: client link exists from birth */
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
                if (body.status !== undefined) {
                  const want = String(body.status);
                  const ok = (inv.status === "draft" && want === "sent") ||
                             (inv.status === "sent" && want === "paid");
                  if (!ok) return json({ error: "invalid status transition (draft → sent → paid)" }, 400);
                  /* Marking paid stamps the paid date, like the web route and the
                     Stripe webhook do (#552) — the list/detail/CSV all read it. */
                  if (want === "paid")
                    db.query("UPDATE invoices SET status = 'paid', paid_at = date('now') WHERE id = ?").run(id);
                  else
                    db.query("UPDATE invoices SET status = ? WHERE id = ?").run(want, id);
                  /* #301: freeze at send, re-freeze at paid for the status badge. */
                  freezeInvoiceSnapshots(id, shareOrigin(req));
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
                  db.query("DELETE FROM invoice_items WHERE invoice_id = ?").run(id);
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

  return { handleApi };
}
