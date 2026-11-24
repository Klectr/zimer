/** JSON API routes: /api/* (timer, entries, clients, projects, invoices,
 *  revenue) plus the unauthenticated Stripe webhook. Returns null when the
 *  path is not an API path so the caller falls through to web routes. */

import type { Database, Statement } from "bun:sqlite";
import { clientColor, clientDay, dayBounds, durationSeconds, entryIsLocked, round2, todayStr, validYmd } from "../lib/format.ts";
import type { Entry, Invoice, InvoiceItem } from "../lib/types.ts";
import { findTenantByPaymentLinkId } from "../lib/tenants.ts"; /* #741 */
import { authedApi as bearerAuthedApi } from "../lib/auth.ts"; /* #984 */
import { originMatches } from "../lib/http.ts"; /* #984 */

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
  revenueSnapshot: () => { totals: any; by_month: any[]; by_client: any[]; overdue: any[] }; /* #1367 */
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
  /* #741: hosted cross-tenant webhook routing. When getTenant returns null
     (hosted, no session), the tenant is resolved from the event's payment
     link id via these; self-host never sets them. */
  dataDir?: string;
  tenantById?: (userId: number) => ApiTenant | null;
  /* #736: hosted subscription gate — true when the request's session user
     is authenticated but past entitlement. Optional so older callers keep
     compiling; server.ts always passes it in hosted mode. */
  inactiveAuthedUser?: (req: Request) => boolean;
}

export function normalizeEntryTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const h = Number(m[4]), mi = Number(m[5]), s = Number(m[6] || 0);
  /* Base year 2000 (a leap year) + setUTCFullYear: Date.UTC maps years
     0-99 to 1900-1999, which would reject 0000-0099 outright (#1434). */
  const wall = new Date(Date.UTC(2000, mo - 1, d, h, mi, s));
  wall.setUTCFullYear(y);
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d
    || wall.getUTCHours() !== h || wall.getUTCMinutes() !== mi || wall.getUTCSeconds() !== s)
    return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/* #1440: a money rate as the web UI accepts it — absent or blank means 0,
   anything provided must be a finite number at or above 0 (null = invalid). */
export function nonNegativeRate(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* #1450: a finished entry must end after it starts — an end at or before
   the start saves a duration that clamps to 0 everywhere downstream. */
export function endAfterStart(startIso: string, endIso: string | null): boolean {
  return endIso === null || new Date(endIso).getTime() > new Date(startIso).getTime();
}

/* #1452: the end a timer stop stores — never at or before the start, even
   when the running entry's start was edited into the future or the stop
   lands in the start's own millisecond. */
export function stopEndTime(startIso: string): string {
  const now = Date.now();
  const start = new Date(startIso).getTime();
  return new Date(Number.isFinite(start) && now <= start ? start + 1000 : now).toISOString();
}

/* #1458: a provided project_id must name a real project — a dangling id
   stores an entry that counts as billable (project_id IS NOT NULL) in
   calendar totals but can never be invoiced, because invoicing reaches
   entries through project → client. A non-numeric id coerces to NaN and
   would silently store NULL instead of the project the caller named.
   Returns the id when it exists, null otherwise. */
export function existingProjectId(db: Database, raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.query("SELECT 1 FROM projects WHERE id = ?").get(n) ? n : null;
}

/* #1464: sibling of existingProjectId for project create — a provided
   client_id must name a real client, or the project renders client-less
   via LEFT JOIN and its time can never be invoiced. */
export function existingClientId(db: Database, raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.query("SELECT 1 FROM clients WHERE id = ?").get(n) ? n : null;
}

/* #1470: a caller-supplied entry_id on invoice create must name an entry
   that can actually be billed to this invoice: it exists, is finished, is
   not already on an invoice, and belongs to the invoice's client through
   its project (the same reach unbilledEntries uses). */
export function entryLinkable(db: Database, id: number, clientId: number | null): boolean {
  const row = db.query(
    `SELECT e.end_time AS end_time, e.invoice_id AS invoice_id, p.id AS project_id, p.client_id AS entry_client_id
     FROM time_entries e LEFT JOIN projects p ON p.id = e.project_id WHERE e.id = ?`).get(id) as any;
  if (!row || !row.end_time || row.invoice_id !== null) return false;
  if (row.project_id === null || row.entry_client_id === null) return false;
  return row.entry_client_id === clientId;
}

export function createApiRouter(deps: ApiDeps) {
  const {
    getTenant, TOKEN, authedApi, json, entryToJson, verifyWebhookSignature, shareOrigin,
    dataDir, tenantById, /* #741 */
    inactiveAuthedUser, /* #736 */
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
            /* #741: hosted webhooks carry no session. Signature is verified
               above, before any tenant lookup; now resolve the owning tenant
               from the event's payment-link id (globally unique per Stripe,
               stored on the invoice at link creation). Only a resolved
               tenant gets a 200 — an unattributable paid session fails loud
               (Stripe retries) instead of silently dropping a paid invoice. */
            let webhookTenant = tenant;
            if (!webhookTenant) {
              if (!dataDir || !tenantById)
                return json({ error: "multi-tenant webhook routing not configured" }, 503);
              const session =
                event.type === "checkout.session.completed" ? event.data?.object || {} : null;
              const paid = !!session && session.payment_status === "paid";
              const pl = session?.payment_link;
              const linkId = typeof pl === "string" ? pl : pl?.id;
              if (!(paid && typeof linkId === "string" && linkId)) {
                /* Not an invoice-payment event, or nothing to attribute it
                   by — acknowledge like the ignored events below. */
                return json({ received: true });
              }
              const userId = findTenantByPaymentLinkId(dataDir, linkId);
              webhookTenant = userId !== null ? tenantById(userId) : null;
              if (!webhookTenant)
                return json({ error: "unresolved tenant for paid checkout session" }, 503);
            }
            const { db, qInvoice, freezeInvoiceSnapshots } = webhookTenant;
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
            /* #984: a request authenticated by the hosted session cookie
               (no Bearer token) carries an ambient credential — mutating
               calls get the same #912 origin check as web routes. Bearer
               calls are not ambient and stay exempt. */
            if (
              method !== "GET" && method !== "HEAD" &&
              !bearerAuthedApi(req, TOKEN) && !originMatches(req)
            )
              return json({ error: "cross-site request blocked" }, 403);
            /* #736: hosted subscription gate — an authed user past
               entitlement gets 403 on the data API. /billing/* never
               reaches this router (the billing router is mounted first),
               so customers can always pay; the unauthenticated Stripe
               webhook above is unaffected. */
            if (inactiveAuthedUser && inactiveAuthedUser(req))
              return json({ error: "subscription_inactive" }, 403);
            const {
              db, qRunning, qOne, qRange, qInvoice, qInvoices,
              groupToLineItems, unbilledEntries, getInvoice,
              invoiceTotals, nextInvoiceNumber, mintPublicToken, stripeLinkFor,
              revenueSnapshot,
              freezeInvoiceSnapshots,
            } = tenant;
            const body = (await req.json().catch(() => ({}))) as any;
            /* #1281: detail projection — more than the #1279 list (items,
               notes, client contact fields, template, paid flag) but never
               internal_notes, the frozen snapshots, the Stripe link/id, or
               the public token. Shared by GET, POST and PATCH responses. */
            const invoiceDetail = (full: Invoice & { items: InvoiceItem[] }) => ({
              id: full.id,
              client_id: full.client_id,
              number: full.number,
              issue_date: full.issue_date,
              due_date: full.due_date,
              status: full.status,
              tax_rate: full.tax_rate,
              notes: full.notes,
              template: full.template,
              created_at: full.created_at,
              paid_at: full.paid_at,
              sent_at: full.sent_at ?? null,
              period_from: full.period_from ?? null,
              period_to: full.period_to ?? null,
              paid_via_stripe: full.paid_via_stripe,
              client_name: full.client_name,
              client_color: full.client_color,
              client_payment_terms: full.client_payment_terms,
              client_email: full.client_email,
              client_phone: full.client_phone,
              client_website: full.client_website,
              client_address: full.client_address,
              items: full.items,
              ...invoiceTotals(full.items, full.tax_rate),
            });

            if (path === "/api/status" && method === "GET") {
              const running = qRunning.get() as Entry | null;
              if (!running) return json({ running: null });
              const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
              const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/;
              const ok = iso.test(from) && iso.test(to) && !isNaN(Date.parse(from)) && !isNaN(Date.parse(to));
              const [f, t] = ok ? [from, to] : dayBounds(todayStr());
              const todaySeconds = (qRange.all(f, t) as Entry[])
                .reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
              return json({
                running: { ...entryToJson(running), client_rate: running.client_rate ?? null },
                today_seconds: todaySeconds,
              });
            }
            if (path === "/api/timer/start" && method === "POST") {
              if (qRunning.get()) return json({ error: "a timer is already running" }, 409);
              const projectId = body.project_id ? existingProjectId(db, body.project_id) : null;
              if (body.project_id && projectId === null)
                return json({ error: "project_id not found" }, 400);
              const r = db.query(
                "INSERT INTO time_entries (project_id, description, start_time) VALUES (?, ?, ?) RETURNING id")
                .get(projectId, String(body.description || ""), new Date().toISOString()) as any;
              return json(entryToJson(qOne.get(r.id) as Entry), 201);
            }
            if (path === "/api/timer/stop" && method === "POST") {
              const running = qRunning.get() as Entry | null;
              if (!running) return json({ error: "no timer running" }, 404);
              db.query("UPDATE time_entries SET end_time = ? WHERE id = ?")
                .run(stopEndTime(running.start_time), running.id);
              return json(entryToJson(qOne.get(running.id) as Entry));
            }
            if (path === "/api/entries" && method === "GET") {
              /* #1494: provided bounds are validated and normalized to
                 canonical ISO instants before they reach the range query —
                 raw strings compare lexicographically, so an invalid `to`
                 ("garbage" sorts after every timestamp) silently returned
                 an unbounded list and a reversed range read as "no
                 entries". Date-only bounds mean that day's UTC midnight.
                 Absent bounds keep the epoch → now defaults. */
              const bound = (raw: string | null): string | null => {
                if (raw === null) return null;
                const ymd = validYmd(raw);
                if (ymd) return `${ymd}T00:00:00.000Z`;
                return normalizeEntryTimestamp(raw);
              };
              const rawFrom = url.searchParams.get("from");
              const rawTo = url.searchParams.get("to");
              const from = rawFrom === null ? new Date(0).toISOString() : bound(rawFrom);
              const to = rawTo === null ? new Date().toISOString() : bound(rawTo);
              if (from === null || to === null || from > to)
                return json({ error: "from/to must be valid timestamps with from on or before to" }, 400);
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
                let startTime = cur.start_time;
                if (body.start_time !== undefined) {
                  const normalized = normalizeEntryTimestamp(body.start_time);
                  if (!normalized)
                    return json({ error: "start_time/end_time must be a valid timestamp with a timezone offset" }, 400);
                  startTime = normalized;
                }
                let endTime = cur.end_time;
                if (body.end_time !== undefined) {
                  if (body.end_time === null) {
                    endTime = null;
                  } else {
                    const normalized = normalizeEntryTimestamp(body.end_time);
                    if (!normalized)
                      return json({ error: "start_time/end_time must be a valid timestamp with a timezone offset" }, 400);
                    endTime = normalized;
                  }
                }
                if (!endAfterStart(startTime, endTime))
                  return json({ error: "end_time must be after start_time" }, 400);
                let projectId = cur.project_id;
                if (body.project_id !== undefined) {
                  if (!body.project_id) projectId = null;
                  else {
                    const pid = existingProjectId(db, body.project_id);
                    if (pid === null)
                      return json({ error: "project_id not found" }, 400);
                    projectId = pid;
                  }
                }
                db.query(`UPDATE time_entries SET description = ?, project_id = ?, start_time = ?, end_time = ? WHERE id = ?`)
                  .run(
                    body.description !== undefined ? String(body.description) : cur.description,
                    projectId,
                    startTime,
                    endTime,
                    id);
                return json(entryToJson(qOne.get(id) as Entry));
              }
              if (method === "DELETE") {
                const cur = qOne.get(id) as Entry | null; /* #334 */
                if (!cur) return json({ error: "not found" }, 404); /* #1482 */
                if (entryIsLocked(cur))
                  return json({ error: "This time is invoiced and can't be deleted." }, 403);
                db.query("DELETE FROM time_entries WHERE id = ?").run(id);
                return new Response(null, { status: 204 });
              }
            }
            if (path === "/api/clients" && method === "GET")
              return json(db.query("SELECT * FROM clients ORDER BY name").all());
            if (path === "/api/clients" && method === "POST") {
              const name = typeof body.name === "string" ? body.name.trim() : "";
              if (!name) return json({ error: "name required" }, 400);
              const rate = nonNegativeRate(body.rate);
              if (rate === null) return json({ error: "rate must be a number at or above 0" }, 400);
              const r = db.query("INSERT INTO clients (name, color, rate) VALUES (?, ?, ?) RETURNING *")
                .get(name, clientColor(body.color), rate) as any;
              return json(r, 201);
            }
            m = path.match(/^\/api\/clients\/(\d+)$/);
            if (m && method === "DELETE") {
              if (!db.query("SELECT 1 FROM clients WHERE id = ?").get(Number(m[1])))
                return json({ error: "not found" }, 404); /* #1482 */
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
              const name = typeof body.name === "string" ? body.name.trim() : "";
              if (!name) return json({ error: "name required" }, 400);
              const hasClient = body.client_id !== undefined && body.client_id !== null && body.client_id !== "";
              const clientId = hasClient ? existingClientId(db, body.client_id) : null;
              if (hasClient && clientId === null)
                return json({ error: "client_id not found" }, 400);
              const r = db.query("INSERT INTO projects (name, client_id) VALUES (?, ?) RETURNING *")
                .get(name, clientId) as any;
              return json(r, 201);
            }
            m = path.match(/^\/api\/projects\/(\d+)$/);
            if (m && method === "DELETE") {
              if (!db.query("SELECT 1 FROM projects WHERE id = ?").get(Number(m[1])))
                return json({ error: "not found" }, 404); /* #1482 */
              /* Schema FK is not enforced: null entries explicitly. */
              db.transaction(() => {
                db.query("UPDATE time_entries SET project_id = NULL WHERE project_id = ?").run(Number(m[1]));
                db.query("DELETE FROM projects WHERE id = ?").run(Number(m[1]));
              })();
              return new Response(null, { status: 204 });
            }
            /* ---- invoicing API ---- */
            if (path === "/api/invoices" && method === "GET") {
              /* #1279: list projection only — the full row carries
                 internal_notes, the frozen HTML/PDF snapshots, the Stripe
                 link id and the public token, none of which belong in a
                 list response. */
              const rows = qInvoices.all() as any[];
              return json(rows.map(r => ({
                id: r.id,
                client_id: r.client_id,
                number: r.number,
                issue_date: r.issue_date,
                due_date: r.due_date,
                status: r.status,
                tax_rate: r.tax_rate,
                paid_at: r.paid_at,
                sent_at: r.sent_at ?? null,
                period_from: r.period_from ?? null,
                period_to: r.period_to ?? null,
                client_name: r.client_name,
                client_color: r.client_color,
                client_payment_terms: r.client_payment_terms,
                project_name: r.project_name,
                subtotal: r.subtotal,
                total: round2(r.subtotal * (1 + (r.tax_rate || 0) / 100)),
              })));
            }
            if (path === "/api/invoices" && method === "POST") {
              const number = String(body.number || nextInvoiceNumber());
              if (db.query("SELECT 1 FROM invoices WHERE number = ?").get(number))
                return json({ error: "invoice number already exists" }, 400);
              /* #1468: a provided client_id must name a real client, as on
                 project create (#1464) — a dangling or non-numeric id would
                 store an invoice that renders client-less and can never be
                 tied back to a client. Absent/empty stays client-less,
                 which client deletes already produce by nulling the FK. */
              const hasClient = body.client_id !== undefined && body.client_id !== null && body.client_id !== "";
              const clientId = hasClient ? existingClientId(db, body.client_id) : null;
              if (hasClient && clientId === null)
                return json({ error: "client_id not found" }, 400);
              /* #1436: issue/due are stored dates — an explicitly provided
                 one must be a real calendar day (validYmd, as #1429);
                 verbatim garbage would feed ordering, overdue math, the
                 PDF and the CSV export. Absent issue_date defaults to
                 today; absent due_date stays null. */
              const issueDate = body.issue_date ? validYmd(body.issue_date) : todayStr();
              if (!issueDate)
                return json({ error: "issue_date must be a valid date (YYYY-MM-DD)" }, 400);
              const dueDate = body.due_date ? validYmd(body.due_date) : null;
              if (body.due_date && !dueDate)
                return json({ error: "due_date must be a valid date (YYYY-MM-DD)" }, 400);
              const taxRate = nonNegativeRate(body.tax_rate);
              if (taxRate === null || !Number.isFinite(round2(taxRate)))
                return json({ error: "tax_rate must be a number at or above 0" }, 400);
              let items: { description: string; hours: number; rate: number; entry_ids?: number[] }[];
              const callerItems = Array.isArray(body.items);
              if (callerItems) {
                items = body.items;
              } else {
                if (!body.client_id || !body.from || !body.to)
                  return json({ error: "client_id, from, to required (or items[])" }, 400);
                const rate = nonNegativeRate(body.rate);
                if (rate === null)
                  return json({ error: "rate must be a number at or above 0" }, 400);
                /* #1492: the range is a stored period and the billing
                   query's window — an impossible date is silently shifted
                   by SQLite date(?, '+1 day') (Feb 30 → Mar 3), billing
                   the wrong window, and a reversed range reads as "no
                   billable items". Validate like the web preview (#1490). */
                const rangeFrom = validYmd(body.from), rangeTo = validYmd(body.to);
                if (!rangeFrom || !rangeTo)
                  return json({ error: "from/to must be valid dates (YYYY-MM-DD)" }, 400);
                if (rangeFrom > rangeTo)
                  return json({ error: "from must be on or before to" }, 400);
                items = groupToLineItems(
                  unbilledEntries(clientId!, rangeFrom, rangeTo),
                  rate);
              }
              /* #1436: per-line billing dates are stored dates too —
                 validate caller-supplied ones the same way. */
              if (Array.isArray(body.items)) {
                for (const it of items) {
                  /* Rows the clean step drops (hours <= 0) store nothing —
                     their dates are not validated. */
                  if (round2(Number((it as any).hours) || 0) <= 0) continue;
                  for (const k of ["date_from", "date_to"] as const) {
                    const v = (it as any)[k];
                    if (v !== undefined && v !== null && v !== "" && !validYmd(v))
                      return json({ error: `${k} must be a valid date (YYYY-MM-DD)` }, 400);
                  }
                }
              }
              /* #1440: every surviving row's rate, whichever path built
                 it — the clean step rounds with round2, whose product can
                 overflow to Infinity for huge finite rates, so the rounded
                 value must stay finite too. */
              for (const it of items) {
                if (round2(Number((it as any).hours) || 0) <= 0) continue;
                const r = nonNegativeRate((it as any).rate);
                if (r === null || !Number.isFinite(round2(r)))
                  return json({ error: "rate must be a number at or above 0" }, 400);
                /* #1446: hours get the same treatment — round2 of a huge
                   finite value overflows to Infinity, and finite hours x
                   rate can overflow the amount the same way. */
                const h = round2(Number((it as any).hours) || 0);
                if (!Number.isFinite(h))
                  return json({ error: "hours must be a finite number above 0" }, 400);
                if (!Number.isFinite(round2(h * round2(r))))
                  return json({ error: "line amount (hours x rate) is too large" }, 400);
              }
              const clean = items
                .map(it => ({
                  description: String(it.description || "Time"),
                  hours: round2(Number(it.hours) || 0),
                  rate: round2(Number(it.rate) || 0),
                  entry_ids: Array.isArray(it.entry_ids) ? it.entry_ids.map(Number).filter(n => n > 0) : [],
                  /* #243: optional per-line billing dates */
                  date_from: validYmd(it.date_from),
                  date_to: validYmd(it.date_to),
                }))
                .filter(it => it.hours > 0);
              /* #1470: caller-supplied entry_ids are linked verbatim below —
                 each one must be billable to this invoice, or the create
                 would steal an entry off another invoice, invoice a running
                 entry, or tie another client's time to this invoice. The
                 from/to path's ids come from unbilledEntries and are
                 linkable by construction. */
              if (callerItems) {
                for (const it of clean) {
                  for (const eid of it.entry_ids) {
                    if (!entryLinkable(db, eid, clientId))
                      return json({ error: "entry_id is not billable to this invoice" }, 400);
                  }
                }
              }
              if (!clean.length) return json({ error: "no billable line items" }, 400);
              /* #1448: per-row checks keep each amount finite, but the
                 derived totals can still overflow — rows summing past the
                 finite range, or a finite subtotal x tax_rate. Reject
                 before insert so detail/list never project null totals. */
              const subtotal = round2(clean.reduce((a, it) => a + round2(it.hours * it.rate), 0));
              const tax = round2(subtotal * taxRate / 100);
              if (!Number.isFinite(subtotal) || !Number.isFinite(tax) || !Number.isFinite(round2(subtotal + tax)))
                return json({ error: "invoice total is too large" }, 400);
              /* #1429: keep from/to as the billing period, like the web
                 wizard (#1350). Only a well-formed, ordered pair is stored;
                 anything else stays NULL and surfaces fall back to line dates. */
              const pFrom = validYmd(body.from), pTo = validYmd(body.to);
              const [periodFrom, periodTo] = pFrom && pTo && pFrom <= pTo ? [pFrom, pTo] : [null, null];
              const inv = db.query(
                `INSERT INTO invoices (client_id, number, issue_date, due_date, tax_rate, notes, internal_notes, period_from, period_to)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
                .get(
                  clientId,
                  number,
                  issueDate,
                  dueDate,
                  taxRate,
                  String(body.notes || ""),
                  String(body.internal_notes || ""),
                  periodFrom, periodTo) as any; /* #302 */
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
              return json(invoiceDetail(full), 201);
            }
            m = path.match(/^\/api\/invoices\/(\d+)$/);
            if (m) {
              const id = Number(m[1]);
              if (method === "GET") {
                const inv = getInvoice(id);
                if (!inv) return json({ error: "not found" }, 404);
                return json(invoiceDetail(inv));
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
                    db.query("UPDATE invoices SET status = 'paid', paid_at = COALESCE(?, date('now')) WHERE id = ?").run(clientDay(body.client_day), id);
                  else
                    db.query("UPDATE invoices SET status = 'sent', sent_at = COALESCE(?, date('now')) WHERE id = ?").run(clientDay(body.client_day), id);
                  /* #301: freeze at send, re-freeze at paid for the status badge. */
                  freezeInvoiceSnapshots(id, shareOrigin(req));
                }
                const full = getInvoice(id)!;
                return json(invoiceDetail(full));
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
              return json(revenueSnapshot()); /* #1367: one row fetch for all four figures */
            return json({ error: "not found" }, 404);
          } catch (err) {
            console.error(`[zimer] API ${method} ${path} threw:`, err);
            return json({ error: "internal" }, 500);
          }

  }

  return { handleApi };
}
