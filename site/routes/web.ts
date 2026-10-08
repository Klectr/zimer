/** Web routes: static files, login/logout, public invoice pages,
 *  and every authenticated page and form action (timer, calendar, manage,
 *  invoices, CSV export, backup, demo data).
 *  Returns null when nothing matched so the caller can fall through. */

import { join, normalize, sep } from "node:path";
import type { Database, Statement } from "bun:sqlite";
import { addDays, csvCell, entryIsLocked, esc, isPaymentTermsKey, round2, termsDays, termsKey, todayStr } from "../lib/format.ts";
import type { Entry, Invoice, InvoiceItem } from "../lib/types.ts";
import type { ClientSel } from "../views/manage.ts"; /* #367 */
import type { PdfInvoice } from "../pdf.ts";
import { getMeta, setMeta } from "../db.ts";
import { clientIp, originMatches, secureCookieAttr } from "../lib/http.ts";
import { createRateLimiter } from "../lib/ratelimit.ts";
import { loadChangelog } from "../lib/changelog.ts"; /* #303 */
import { licenseTerms } from "../lib/license-terms.ts"; /* #341 */
import { appVersion } from "../lib/version.ts"; /* #730 */
import { updateSectionHtml, checkForUpdates, updateStatusHtml } from "../lib/updates.ts"; /* #340 */
import { THEMES, themeCss, themeKey } from "../lib/theme.ts"; /* #884 */
import type { AccountsDb } from "../lib/accounts.ts"; /* #732 */
import { findTenantByPublicToken } from "../lib/tenants.ts"; /* #741 */

/* #733: everything derived from one tenant's SQLite bundle. Resolved per
   request from the session (session → user → tenant tree, cached by user
   id); self-host resolves the single global bundle, so behavior there is
   unchanged. */
export interface WebTenant {
  db: Database;
  dbPath: string; /* tenant's timekeep.db file — /backup downloads exactly this */
  qRunning: Statement;
  qOne: Statement;
  qRange: Statement;
  qInvoice: Statement;
  qInvoices: Statement;
  notFoundPage: (authed: boolean) => string;
  errorPage: (authed: boolean) => string;
  dashboardPage: () => string;
  timerPartial: () => string;
  todayPartial: (from?: string, to?: string) => string;
  weekInner: (weekStr?: string, tz?: string) => string;
  weekStrip: (weekStr?: string, tz?: string) => string;
  calendarPage: (week?: string) => string;
  editPage: (id: number) => string | null;
  editEntryDialog: (id: number) => string | null; /* #903 */
  managePage: (selected: ClientSel | null) => string; /* #367 */
  clientSelection: (raw: string | null) => ClientSel | null; /* #367 */
  clientDetailBody: (sel: ClientSel) => string; /* #367 */
  clientListOob: (sel: ClientSel | null) => string; /* #367 */
  bizProfileSection: () => string;
  dailyTargetSection: () => string; /* #908 */
  clientSettingsForm: (c: any) => string; /* #630 */
  settingsPage: (body: string) => string; /* #693 */
  themeSectionHtml: () => string; /* #884 */
  invoicesPage: (selected: (Invoice & { items: InvoiceItem[] }) | null, origin: string) => string;
  invoiceNewPage: (p: any, preview?: any) => string;
  defaultNewInvParams: () => any;
  invoiceStep2: (p: any, preview?: any) => string;
  invoiceDetailBody: (inv: Invoice & { items: InvoiceItem[] }, origin: string) => string;
  invoiceListOob: (selectedId: number) => string; /* #364 */
  invoiceDoc: (inv: Invoice & { items: InvoiceItem[] }) => string;
  publicInvoicePage: (inv: Invoice & { items: InvoiceItem[] }) => string;
  getInvoice: (id: number) => (Invoice & { items: InvoiceItem[] }) | null;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  nextInvoiceNumber: () => string;
  stripeLinkFor: (id: number) => Promise<{ url?: string; error?: string; status?: number }>;
  unbilledEntries: (clientId: number, from: string, to: string) => any[];
  groupToLineItems: (entries: any[], rate: number) => any[];
  clientRestFrom: (clientId: number) => string | null;
  ensurePublicToken: (id: number) => string;
  getPublicToken: (id: number) => string | null;
  mintPublicToken: (id: number) => string;
  invoicePdfInput: (inv: Invoice & { items: InvoiceItem[] }, origin: string) => PdfInvoice; /* #301 */
  freezeInvoiceSnapshots: (id: number, origin: string) => void; /* #301 */
}

/** #912: the CSRF rejection page — minimal public chrome, no app nav leaked. */
function csrfBlockedPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Request blocked · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg"></head>
  <body><main class="login">
  <div class="md-card" style="border-radius:28px;padding:28px;max-width:420px">
  <h1 class="md-headline-small" style="margin-top:0">Request blocked</h1>
  <p class="muted">This action was refused because it didn't come from the app itself. If you reached this page from inside Zimer, please try again.</p>
  </div></main></body></html>`;
}

export interface WebDeps {
  /* #733: per-request tenant resolution. Null = hosted mode with no session
     (public paths only); self-host always returns the global tree. */
  getTenant: (req: Request) => WebTenant | null;
  STATIC_DIR: string;
  TOKEN: string;
  authedPage: (req: Request, token: string) => boolean;
  tokensEqual: (a: string, b: string) => boolean;
  html: (body: string, status?: number, extra?: Record<string, string>) => Response;
  json: (data: unknown, status?: number) => Response;
  isHtmx: (req: Request) => boolean;
  csvResponse: (filename: string, rows: string[][]) => Response;
  shareOrigin: (req: Request) => string;
  PORT: number;
  loginPage: () => string;
  signupPage: (error?: string) => string; /* #732 */
  hostedLoginPage: (error?: string) => string; /* #732 */
  HOSTED: boolean; /* #732 */
  accounts: AccountsDb | null; /* #732 */
  backupHealth: (() => { accounts: string | null; tenants: number }) | null; /* #730 part 2 */
  changelogPage: (entries: import("../lib/changelog.ts").ChangelogEntry[]) => string;
  termsPage: (sections: import("../lib/license-terms.ts").TermsSection[]) => string; /* #341 */
  privacyPage: () => string; /* #730 */
  noSuchInvoicePage: () => string;
  rateLimitPage: () => string;
  /* #733: public-chrome 404/500 for the pre-auth paths — no tenant, no app
     layout. The tenant tree carries the authed (app-layout) variants. */
  notFoundPage: (authed: boolean) => string;
  errorPage: (authed: boolean) => string;
  invoicePdf: (inv: PdfInvoice) => Uint8Array;
  stripeConfigured: () => boolean;
  workspaceEmpty: (db: Database) => boolean;
  demoIds: (db: Database) => number[];
  seedDemoData: (db: Database) => void;
  removeDemoData: (db: Database) => void;
  entryToJson: (e: Entry) => any;
  /* #736: hosted subscription gate — true when the request's session user
     is authenticated but past entitlement. Optional so older callers keep
     compiling; server.ts always passes it in hosted mode. */
  inactiveAuthedUser?: (req: Request) => boolean;
  /* #741: hosted cross-tenant public-invoice routing. When set (hosted),
     /i/:token resolves by scanning the tenant DBs instead of using the
     session tenant; self-host never sets them. */
  dataDir?: string;
  tenantById?: (userId: number) => WebTenant | null;
}

export function createWebRouter(deps: WebDeps) {
  const {
    getTenant, STATIC_DIR, TOKEN, authedPage, tokensEqual, html, json, csvResponse, isHtmx,
    shareOrigin, PORT, loginPage, signupPage, hostedLoginPage, HOSTED, accounts, backupHealth,
    changelogPage, termsPage, privacyPage, noSuchInvoicePage, rateLimitPage,
    notFoundPage: publicNotFound, errorPage: publicError,
    invoicePdf, stripeConfigured,
    workspaceEmpty, demoIds, seedDemoData, removeDemoData, entryToJson,
    inactiveAuthedUser, /* #736 */
    dataDir, tenantById, /* #741 */
  } = deps;

  /* #308: rate limits for the public surface — in-memory, per client IP.
     A page view pulls ~4 subrequests (html, css, logo, motion.js). */
  const invoiceLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
  const loginLimiter = createRateLimiter({ windowMs: 5 * 60_000, max: 10 });

  /* #732: page auth in hosted mode is a valid account session; self-host
     keeps the single shared token. */
  const pageAuthed = (req: Request): boolean =>
    HOSTED ? accounts!.sessionUserFromRequest(req) !== null : authedPage(req, TOKEN);

  /** Serve a web request, or null when the path is not a web route. */
  async function handleWeb(req: Request, url: URL, path: string, method: string): Promise<Response | null> {
        /* #912: CSRF — mutating web routes are same-origin only. The request's
           Origin (or Referer) must name this host; a forged cross-site request
           carries the attacker's origin and is rejected before anything else
           runs. /api/* and /billing/* are dispatched before handleWeb and are
           exempt here (Bearer tokens / Stripe signatures aren't forgeable). */
        if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !originMatches(req)) {
          return html(csrfBlockedPage(), 403);
        }
        /* #733: resolve this request's tenant up front. Null = hosted mode
           with no session — only the public paths below may run. Self-host
           always resolves the single global tree. */
        const tenant = getTenant(req);
        /* Pre-auth paths render through the tenant when there is one, else
           the pure public-chrome pages (no app layout, no tenant reads). */
        const pages = tenant ?? { notFoundPage: publicNotFound, errorPage: publicError };
        /* static + login (no auth) */
        if (path.startsWith("/static/")) {
          const p = normalize(join(STATIC_DIR, path.slice("/static/".length)));
          if (!p.startsWith(STATIC_DIR + sep) && p !== STATIC_DIR) return new Response("Forbidden", { status: 403 });
          const f = Bun.file(p);
          if (!(await f.exists())) return html(pages.notFoundPage(authedPage(req, TOKEN)), 404);
          /* #374: filenames aren't fingerprinted, so browsers must revalidate
             every load — otherwise a deploy's new CSS/JS never reaches cached
             clients. ETag from size+mtime; If-None-Match gets a 304. */
          const etag = `"${f.size.toString(36)}-${Math.floor(f.lastModified / 1000).toString(36)}"`;
          if (req.headers.get("if-none-match") === etag) {
            return new Response(null, { status: 304 });
          }
          return new Response(f, { headers: { ETag: etag, "Cache-Control": "public, no-cache" } });
        }
        if (path === "/login") {
          if (method === "GET") {
            /* #379: already logged in — bounce to the timer. */
            if (pageAuthed(req)) {
              return new Response(null, { status: 302, headers: { Location: "/" } });
            }
            return html(HOSTED ? hostedLoginPage() : loginPage());
          }
          if (method === "POST") {
            /* #308: slow down credential brute-forcing. */
            const rl = loginLimiter.check(clientIp(req));
            if (!rl.allowed) {
              return html(rateLimitPage(), 429, { "Retry-After": String(rl.retryAfterSec) });
            }
            const form = await req.formData();
            if (HOSTED) {
              /* #732: email + password against the accounts control plane. */
              const { token, error } = await accounts!.login(
                String(form.get("email") || ""),
                String(form.get("password") || "")
              );
              if (token) {
                return new Response(null, {
                  status: 302,
                  headers: { Location: "/", "Set-Cookie": accounts!.sessionCookie(req, token) },
                });
              }
              return html(hostedLoginPage(error), 401);
            }
            if (tokensEqual(String(form.get("token") || ""), TOKEN)) {
              return new Response(null, {
                status: 302,
                headers: {
                  Location: "/",
                  "Set-Cookie": `tk=${encodeURIComponent(TOKEN)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${secureCookieAttr(req)}`,
                },
              });
            }
            return html(loginPage().replace("</form>", `<p class="error">Wrong token.</p></form>`), 401);
          }
        }
        /* #732: hosted signup — 404 in self-host mode. */
        if (HOSTED && path === "/signup") {
          if (method === "GET") {
            if (pageAuthed(req)) {
              return new Response(null, { status: 302, headers: { Location: "/" } });
            }
            return html(signupPage());
          }
          if (method === "POST") {
            const rl = loginLimiter.check(clientIp(req));
            if (!rl.allowed) {
              return html(rateLimitPage(), 429, { "Retry-After": String(rl.retryAfterSec) });
            }
            const form = await req.formData();
            const { user, error } = await accounts!.signup(
              String(form.get("email") || ""),
              String(form.get("password") || "")
            );
            if (user) {
              const token = accounts!.createSession(user.id);
              const cookie = accounts!.sessionCookie(req, token);
              /* #791: no card up front — the 14-day trial starts the moment
                 the account exists (local trial grant + billing wall at
                 expiry). Signup drops straight into the app; Stripe only
                 enters at the billing wall, after the user has felt the
                 product. */
              return new Response(null, {
                status: 302,
                headers: { Location: "/", "Set-Cookie": cookie },
              });
            }
            return html(signupPage(error), 400);
          }
        }
        /* #912: logout is POST-only — a GET logout is CSRF-able via an <img>
           tag, and a forged click logs the victim out of their own app. */
        if (path === "/logout" && method === "POST") {
          if (HOSTED) {
            /* #732 */
            const t = accounts!.sessionTokenFromRequest(req);
            if (t) accounts!.destroySession(t);
            return new Response(null, {
              status: 302,
              headers: { Location: "/login", "Set-Cookie": accounts!.clearSessionCookie(req) },
            });
          }
          return new Response(null, {
            status: 302,
            headers: { Location: "/login", "Set-Cookie": `tk=; HttpOnly; Path=/; Max-Age=0${secureCookieAttr(req)}` },
          });
        }
        if (path === "/logout") {
          return new Response(null, { status: 405, headers: { Allow: "POST" } });
        }

        /* #730: health check for external uptime monitoring. No auth, no rate
           limit — monitoring services hit this every few minutes, and it
           must answer even when the app is otherwise idle. */
        if (path === "/health" && method === "GET") {
          return json({
            ok: true,
            version: appVersion(),
            /* #730 part 2: backup freshness, hosted mode only. `accounts` is
               the ISO time of the newest accounts.db backup (null when none);
               `tenants` counts tenants whose newest backup is under 24h old. */
            ...(backupHealth ? { backups: backupHealth() } : {}),
          });
        }

        /* #341: public terms page — no auth, same rate limit as the public
           invoice surface. */
        if (path === "/terms" && method === "GET") {
          const rl = invoiceLimiter.check(clientIp(req));
          if (!rl.allowed) {
            return html(rateLimitPage(), 429, { "Retry-After": String(rl.retryAfterSec) });
          }
          return html(termsPage(licenseTerms()));
        }

        /* #730: public privacy policy — no auth, same rate limit and chrome
           as /terms. */
        if (path === "/privacy" && method === "GET") {
          const rl = invoiceLimiter.check(clientIp(req));
          if (!rl.allowed) {
            return html(rateLimitPage(), 429, { "Retry-After": String(rl.retryAfterSec) });
          }
          return html(privacyPage());
        }

        /* #303: public changelog — no auth, same rate limit as the public
           invoice surface. Linked from the public invoice footer. */
        if (path === "/changelog" && method === "GET") {
          const rl = invoiceLimiter.check(clientIp(req));
          if (!rl.allowed) {
            return html(rateLimitPage(), 429, { "Retry-After": String(rl.retryAfterSec) });
          }
          return html(changelogPage(await loadChangelog()));
        }

        /* Public client invoice page: no auth, read-only. The token is a
           credential — it is never logged, and unknown tokens 404. */

        const pub = path.match(/^\/i\/([A-Za-z0-9_-]{16,64})$/);
        if (pub && method === "GET") {
          /* #308: rate-limit before the DB lookup. */
          const rl = invoiceLimiter.check(clientIp(req));
          if (!rl.allowed) {
            return html(rateLimitPage(), 429, { "Retry-After": String(rl.retryAfterSec) });
          }
          /* #741: hosted public links carry no session — route the token to
             its tenant by scanning the tenant DBs (no routing map in the
             control plane). The token is a credential: never logged. In
             self-host the session/singleton tenant serves as before. */
          let t = tenant;
          if (HOSTED && dataDir && tenantById) {
            const userId = findTenantByPublicToken(dataDir, pub[1]);
            t = userId !== null ? tenantById(userId) : null;
          }
          if (!t) return html(noSuchInvoicePage(), 404);
          const idRow = t.db.query("SELECT id FROM invoices WHERE public_token = ?").get(pub[1]) as { id: number } | null;
          const inv = idRow ? t.getInvoice(idRow.id) : null;
          return inv ? html(t.publicInvoicePage(inv)) : html(noSuchInvoicePage(), 404);
        }
        /* Malformed /i/ paths (too short, bad chars): same dead-end. */
        if (method === "GET" && (path === "/i" || path === "/i/" || path.startsWith("/i/"))) {
          return html(noSuchInvoicePage(), 404);
        }

        /* ---- JSON API is handled by routes/api.ts via handleApi; web routes continue below. ---- */

        /* ---- pages ---- */
        try {
          if (!pageAuthed(req)) {
            return new Response(null, { status: 302, headers: { Location: "/login" } });
          }
          /* #733: the session gate above guarantees a tenant in hosted mode
             (session → user → tenant tree); self-host always has one. */
          if (!tenant) {
            return new Response(null, { status: 302, headers: { Location: "/login" } });
          }
          /* #736: hosted subscription gate — a session user past entitlement
             302s to the billing wall. The auth/billing/legal/pricing/health
             surface is all handled above (before this section), and /billing
             is served by the billing router, so nothing allowlisted is
             reachable from here; everything else redirects. Self-host never
             gates. */
          if (HOSTED && inactiveAuthedUser && inactiveAuthedUser(req)) {
            return new Response(null, { status: 302, headers: { Location: "/billing" } });
          }
          const {
            db, dbPath, qRunning, qOne, qRange, qInvoice, qInvoices,
            notFoundPage, errorPage,
            dashboardPage, timerPartial, todayPartial, weekInner, weekStrip,
            calendarPage, editPage, editEntryDialog, managePage, clientSelection, clientDetailBody, clientListOob, bizProfileSection, dailyTargetSection, clientSettingsForm, settingsPage, themeSectionHtml, invoicesPage, invoiceNewPage,
            defaultNewInvParams, invoiceStep2, invoiceDetailBody, invoiceListOob, invoiceDoc, publicInvoicePage,
            getInvoice, invoiceTotals,
            nextInvoiceNumber, stripeLinkFor, unbilledEntries,
            groupToLineItems, clientRestFrom, ensurePublicToken, getPublicToken, mintPublicToken,
            invoicePdfInput, freezeInvoiceSnapshots,
          } = tenant;

          if (path === "/" && method === "GET") return html(dashboardPage());
          if (path === "/partial/timer" && method === "GET") return html(timerPartial());
          /* #572: ?strip=1 fills one recycled carousel strip with a single
             week's inner HTML; without it the full three-week window renders. */
          if (path === "/partial/week" && method === "GET") {
            const w = new URL(req.url).searchParams.get("week") || undefined;
            const tz = new URL(req.url).searchParams.get("tz") || undefined;
            const strip = new URL(req.url).searchParams.get("strip");
            return html(strip ? weekStrip(w || undefined, tz || undefined) : weekInner(w || undefined, tz || undefined));
          }
          /* #255: the client passes its own day bounds as UTC instants
             (?from=&to=, from client-local midnight); validate strictly,
             fall back to the server's day. */
          if (path === "/partial/today" && method === "GET") {
            const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
            const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/;
            const ok = iso.test(from) && iso.test(to) && !isNaN(Date.parse(from)) && !isNaN(Date.parse(to));
            return html(ok ? todayPartial(from, to) : todayPartial());
          }
          /* #328: "invoice the rest" for the new-invoice client picker — returns the
             #inv-range fields with from/to filled from the client's billing
             history (day after its last invoice through-date, else its earliest
             unbilled entry, else the default range). */
          if (path === "/partial/invoice-rest" && method === "GET") {
            const cid = url.searchParams.get("client_id") || "";
            let from = defaultNewInvParams().from;
            if (/^\d+$/.test(cid)) {
              const restFrom = clientRestFrom(Number(cid));
              if (restFrom) from = restFrom;
            }
            const to = todayStr();
            return html(`<div class="md-text-field filled"><input type="date" id="inv-from" name="from" value="${esc(from)}" required placeholder=" "><label>From</label></div>
            <div class="md-text-field filled"><input type="date" id="inv-to" name="to" value="${esc(to)}" required placeholder=" "><label>To</label></div>`);
          }
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
          if (path === "/calendar" && method === "GET") {
            /* #572: day mode is gone; old ?day= links redirect to the
               containing week. Invalid values fall back to this week. */
            const dp = url.searchParams.get("day");
            if (dp && /^\d{4}-\d{2}-\d{2}$/.test(dp)) {
              const [y, m, d] = dp.split("-").map(Number);
              const sun = addDays(dp, -new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay());
              return new Response(null, { status: 302, headers: { Location: `/calendar?week=${sun}` } });
            }
            return html(calendarPage(url.searchParams.get("week") || undefined));
          }

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
            /* #903: htmx gets the dialog fragment for the timer-page modal;
               direct visits keep the full edit page. */
            if (isHtmx(req)) {
              const frag = editEntryDialog(Number(m[1]));
              return frag ? html(frag) : new Response("Not found", { status: 404 });
            }
            const page = editPage(Number(m[1]));
            return page ? html(page) : html(notFoundPage(authedPage(req, TOKEN)), 404);
          }
        m = path.match(/^\/entries\/(\d+)$/);
        if (m && method === "POST") {
          const id = Number(m[1]);
          /* #334: sent/paid time is a frozen record — edit form and calendar
             resize both land here. */
          const cur = qOne.get(id) as Entry | null;
          if (cur && entryIsLocked(cur))
            return new Response("This time is invoiced and can't be edited.", { status: 403 });
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
          return isHtmx(req)
            /* #903: the timer edit dialog posts via htmx — answer HX-Trigger
               so #today-list refreshes in place; no-JS keeps the 302. */
            ? new Response(null, { status: 200, headers: { "HX-Trigger": "timer-updated" } })
            : new Response(null, { status: 302, headers: { Location: "/calendar" } });
        }
        if (m && method === "DELETE") {
          const cur = qOne.get(Number(m[1])) as Entry | null; /* #334 */
          if (cur && entryIsLocked(cur))
            return new Response("This time is invoiced and can't be deleted.", { status: 403 });
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
          /* #733: dbPath is the tenant's own file in hosted mode. */
          const now = new Date();
          const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
          const bytes = await Bun.file(dbPath).bytes();
          return new Response(bytes, { status: 200, headers: {
            "Content-Type": "application/x-sqlite3",
            "Content-Disposition": `attachment; filename="zimer-backup-${ts}.db"`,
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
          return csvResponse(out.join("\n"), "zimer-entries.csv");
        }

        if (path === "/export/invoices.csv" && method === "GET") {
          const rows = db.query(`
            SELECT i.number, i.issue_date, i.due_date, i.status, i.tax_rate, i.paid_at,
                   c.name AS client,
                   (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) AS items,
                   (SELECT COALESCE(SUM(amount), 0) FROM invoice_items WHERE invoice_id = i.id) AS subtotal
            FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
            ORDER BY i.issue_date DESC`).all() as any[];
          const out = ["number,client,issue_date,due_date,status,paid_date,items,subtotal,tax,total"];
          for (const r of rows) {
            const subtotal = Number(r.subtotal || 0);
            const tax = subtotal * Number(r.tax_rate || 0) / 100;
            const cells = [r.number, r.client || "", r.issue_date, r.due_date || "",
              r.status, r.paid_at || "", String(r.items), subtotal.toFixed(2), tax.toFixed(2),
              (subtotal + tax).toFixed(2)];
            out.push(cells.map(csvCell).join(","));
          }
          return csvResponse(out.join("\n"), "zimer-invoices.csv");
        }

        /* #367: M3 list-detail — ?client=<id> (or "none") selects into the
           detail pane (two-pane ≥840px) or the single-pane detail screen;
           fragment=detail is the HTMX swap the list pane's row clicks request. */
        if (path === "/manage" && method === "GET") {
          const sp = new URL(req.url).searchParams;
          let sel = clientSelection(sp.get("client"));
          /* #805: same default as zinvoices — first client fills the detail
             pane on desktop; no has-selection, so mobile still opens the list. */
          let isDefault = false;
          if (!sel) {
            const first = db.query("SELECT * FROM clients ORDER BY name").get() as any;
            if (first) { sel = { kind: "client", client: first }; isDefault = true; }
            /* #835: with no clients at all, the No-client row is the first
               row — default to it so the detail pane has content. */
            else { sel = { kind: "none" }; isDefault = true; }
          }
          if (sp.get("fragment") === "detail" && isHtmx(req)) {
            if (!sel) return new Response("Client not found.", { status: 404 });
            /* #367: the OOB list carries the selected row — the pushed-URL
               history snapshot then restores the right selection on back. */
            const push = sel.kind === "client" ? `/manage?client=${sel.client.id}` : "/manage?client=none";
            return html(clientDetailBody(sel) + clientListOob(sel), 200, { "HX-Push-Url": push });
          }
          return html(managePage(sel, isDefault));
        }
        /* #233: business profile for the Modern PDF template's FROM block.
           #245: rendered inside the settings modal (GET) and saved from it
           (POST); no longer part of the Manage page. */
        if (path === "/business-profile" && method === "GET") return html(bizProfileSection());
        if (path === "/business-profile" && method === "POST") {
          const form = await req.formData();
          setMeta(db, "business_name", String(form.get("business_name") || "").trim());
          setMeta(db, "business_email", String(form.get("business_email") || "").trim());
          setMeta(db, "business_address", String(form.get("business_address") || "").trim());
          /* #243: payment terms. #293: fixed option list — reject anything
             that isn't a known key. */
          const gterms = String(form.get("business_payment_terms") || "").trim();
          if (!isPaymentTermsKey(gterms)) return new Response("Unknown payment terms.", { status: 400 });
          setMeta(db, "business_payment_terms", gterms);
          if (isHtmx(req)) return html(bizProfileSection());
          return new Response(null, { status: 302, headers: { Location: "/manage" } });
        }
        /* #908: daily hours target — pacing bars + calendar short-day tint.
           Validates to 1–24h (halves allowed); rejects anything else with
           400 and leaves the stored value untouched. */
        if (path === "/daily-target" && method === "POST") {
          const form = await req.formData();
          const hours = Number(String(form.get("day_target_hours") || "").trim());
          if (!Number.isFinite(hours) || hours < 1 || hours > 24)
            return new Response("Enter a daily target between 1 and 24 hours.", { status: 400 });
          setMeta(db, "day_target_hours", String(hours));
          if (isHtmx(req)) return html(dailyTargetSection());
          return new Response(null, { status: 302, headers: { Location: "/settings" } });
        }
        /* #883: settings modal body — business profile, theme, Updates
           section, support channel. The License section left with the
           retired $59 key. */
        if (path === "/settings" && method === "GET") {
          const updates = updateSectionHtml();
          const support = `<p class="muted tiny" style="margin-top:24px">Need help? <a href="mailto:support@klectr.dev">support@klectr.dev</a></p>`;
          const body = bizProfileSection() + dailyTargetSection() + themeSectionHtml() + updates + support;
          if (isHtmx(req)) return html(body);
          /* #693: direct visits get the full app layout — the bare fragment
             renders unstyled. */
          return html(settingsPage(body));
        }
        /* #884: accent theme. Unknown keys are rejected — the dots only ever
           post known keys, so this guards hand-built requests. The OOB
           <style> swaps the layout's theme override live behind the modal. */
        if (path === "/settings/theme" && method === "POST") {
          const form = await req.formData();
          const key = String(form.get("theme") || "").trim().toLowerCase();
          if (!THEMES.some((t) => t.key === key)) return new Response("Unknown theme.", { status: 400 });
          setMeta(db, "theme", key);
          if (isHtmx(req)) return html(themeSectionHtml() +
            `<style id="theme-style" hx-swap-oob="true">${themeCss(key)}</style>`);
          return new Response(null, { status: 302, headers: { Location: "/settings" } });
        }
        /* #340: manual update check — fetches the release feed server-side
           and swaps the result into the Updates section. Authed like the
           rest of settings; never called automatically. */
        if (path === "/check-updates" && method === "POST") {
          return html(updateStatusHtml(await checkForUpdates()));
        }
        if (path === "/clients" && method === "POST") {
          const form = await req.formData();
          const r = db.query("INSERT INTO clients (name, color, rate) VALUES (?, ?, ?) RETURNING id")
            .get(String(form.get("name")), String(form.get("color") || "#fb923c"),
                 Number(form.get("rate") || 0)) as any;
          /* #367: plain POST (see the add-client form) — land on the new
             client selected, on every width. */
          return new Response(null, { status: 302, headers: { Location: `/manage?client=${r.id}` } });
        }
        /* #630: client settings modal — all seven editable client fields.
           Replaces the old inline /name, /contact, /rate, and /terms routes.
           Name is required; rate must be a number at or above 0 (blank → 0,
           the column is NOT NULL); payment terms are blank (NULL → global
           fallback) or a known key; contact fields are trimmed with blanks
           stored as NULL; textarea newlines arrive as CRLF (multipart
           normalization) — store plain LF. */
        m = path.match(/^\/clients\/(\d+)\/settings$/);
        if (m && method === "GET") {
          const sel = clientSelection(m[1]);
          if (!sel || sel.kind !== "client") return new Response("Client not found.", { status: 404 });
          return html(clientSettingsForm(sel.client));
        }
        if (m && method === "POST") {
          const form = await req.formData();
          const name = String(form.get("name") || "").trim();
          if (!name) return new Response("Client name is required.", { status: 400 });
          const rateRaw = String(form.get("rate") || "").trim();
          const rate = rateRaw === "" ? 0 : Number(rateRaw);
          if (!Number.isFinite(rate) || rate < 0)
            return new Response("Hourly rate must be a number at or above 0.", { status: 400 });
          const terms = String(form.get("payment_terms") || "").trim();
          if (terms !== "" && !isPaymentTermsKey(terms)) return new Response("Unknown payment terms.", { status: 400 });
          const clean = (v: unknown) => { const s = String(v || "").trim(); return s || null; };
          const addr = clean(form.get("address"));
          db.query("UPDATE clients SET name = ?, rate = ?, payment_terms = ?, email = ?, phone = ?, website = ?, address = ? WHERE id = ?")
            .run(name, rate, terms || null, clean(form.get("email")), clean(form.get("phone")),
                 clean(form.get("website")), addr && addr.replace(/\r\n/g, "\n"), Number(m[1]));
          if (isHtmx(req)) {
            const sel = clientSelection(m[1]);
            return html(sel && sel.kind === "client" ? clientSettingsForm(sel.client) : "");
          }
          return new Response(null, { status: 302, headers: { Location: `/manage?client=${m[1]}` } });
        }
        m = path.match(/^\/clients\/(\d+)\/delete$/);
        if (m && method === "POST") {
          /* FK actions in the schema are not enforced (no PRAGMA foreign_keys):
             null these out explicitly so nothing dangles. */
          db.transaction(() => {
            db.query("UPDATE projects SET client_id = NULL WHERE client_id = ?").run(Number(m[1]));
            db.query("UPDATE invoices SET client_id = NULL WHERE client_id = ?").run(Number(m[1]));
            db.query("DELETE FROM clients WHERE id = ?").run(Number(m[1]));
          })();
          /* #367: plain POST — the selection is gone, so land on the bare list. */
          return new Response(null, { status: 302, headers: { Location: "/manage" } });
        }
        if (path === "/projects" && method === "POST") {
          const form = await req.formData();
          const cid = form.get("client_id");
          db.query("INSERT INTO projects (name, client_id) VALUES (?, ?)")
            .run(String(form.get("name")), cid ? Number(cid) : null);
          const sel = clientSelection(cid ? String(cid) : "none"); /* #367 */
          if (isHtmx(req)) return html(clientDetailBody(sel!) + clientListOob(sel));
          const push = cid ? `/manage?client=${cid}` : "/manage?client=none";
          return new Response(null, { status: 302, headers: { Location: push } });
        }
        m = path.match(/^\/projects\/(\d+)\/delete$/);
        if (m && method === "POST") {
          /* Which detail pane owns this project — needed before the delete. */
          const p = db.query("SELECT client_id FROM projects WHERE id = ?").get(Number(m[1])) as any;
          /* Schema FK is not enforced: null entries explicitly. */
          db.transaction(() => {
            db.query("UPDATE time_entries SET project_id = NULL WHERE project_id = ?").run(Number(m[1]));
            db.query("DELETE FROM projects WHERE id = ?").run(Number(m[1]));
          })();
          const sel = clientSelection(p && p.client_id ? String(p.client_id) : "none"); /* #367 */
          if (isHtmx(req)) return html(clientDetailBody(sel!) + clientListOob(sel));
          const push = p && p.client_id ? `/manage?client=${p.client_id}` : "/manage?client=none";
          return new Response(null, { status: 302, headers: { Location: push } });
        }

        /* #299: one-click "invoice this period". /invoices/new?from=YYYY-MM-DD&to=YYYY-MM-DD
           prefills the range; when exactly one client has finished, unbilled entries in
           the range, that client is preselected (rate + due date from its payment terms)
           and step 2 renders immediately with the grouped line items.
           #328: ?client_id=N (without from/to) is "invoice the rest" — preselects the
           client and fills the range from the day after its last invoice through-date
           (or its earliest unbilled entry) to tomorrow. */
        function prefillNewInvoice(sp: URLSearchParams): { p: any; preview?: any } {
          const p: any = defaultNewInvParams();
          const from = sp.get("from"), to = sp.get("to");
          const ymdRe = new RegExp("^\\d{4}-\\d{2}-\\d{2}$");
          if (from && to && ymdRe.test(from) && ymdRe.test(to) && from < to) {
            p.from = from; p.to = to;
            const f = from + "T00:00:00", t = to + "T00:00:00";
            const billable = db.query(`
            SELECT DISTINCT c.id, c.rate, c.payment_terms
            FROM time_entries e
            JOIN projects pr ON pr.id = e.project_id
            JOIN clients c ON c.id = pr.client_id
            WHERE e.invoice_id IS NULL AND e.end_time IS NOT NULL
              AND e.start_time >= ? AND e.start_time < date(?, '+1 day')`).all(f, t) as any[];
            if (billable.length !== 1) return { p };
            const c = billable[0];
            p.client_id = String(c.id);
            if (c.rate !== null && c.rate !== "") p.rate = String(c.rate);
            /* Mirror the client-side deriveDue (#293): due date follows the client's terms. */
            const days = termsDays(termsKey(c.payment_terms, getMeta(db, "business_payment_terms")));
            if (days !== null) p.due_date = addDays(p.issue_date, days);
            const entries = unbilledEntries(Number(c.id), f, t);
            const preview = entries.length
              ? { items: groupToLineItems(entries, Number(p.rate) || 0), rounding: 5 }
              : { items: [], emptyMsg: "No unbilled, finished entries on this client's projects in that range." };
            return { p, preview };
          }
          const cid = sp.get("client_id");
          if (cid && /^\d+$/.test(cid)) {
            const c = db.query("SELECT id, rate, payment_terms FROM clients WHERE id = ?").get(Number(cid)) as any;
            if (c) {
              p.client_id = String(c.id);
              const restFrom = clientRestFrom(Number(c.id));
              if (restFrom) p.from = restFrom;
              p.to = todayStr();
              if (c.rate !== null && c.rate !== "") p.rate = String(c.rate);
              const days = termsDays(termsKey(c.payment_terms, getMeta(db, "business_payment_terms")));
              if (days !== null) p.due_date = addDays(p.issue_date, days);
            }
          }
          return { p };
        }

        /* ---- invoicing pages ---- */
        /* #364: M3 list-detail — ?invoice=<id> selects into the detail pane
           (two-pane ≥840px) or the single-pane detail screen; fragment=detail
           is the HTMX swap the list pane's row clicks request. */
        if (path === "/invoices" && method === "GET") {
          const sp = new URL(req.url).searchParams;
          const selRaw = sp.get("invoice");
          const selId = selRaw && /^\d+$/.test(selRaw) ? Number(selRaw) : null;
          if (sp.get("fragment") === "detail" && isHtmx(req)) {
            const inv = selId ? getInvoice(selId) : null;
            if (!inv) return new Response("Zinvoice not found.", { status: 404 });
            /* #364: the OOB list carries the selected row — the pushed-URL
               history snapshot then restores the right selection on back. */
            return html(invoiceDetailBody(inv, shareOrigin(req)) + invoiceListOob(inv.id), 200,
              { "HX-Push-Url": `/invoices?invoice=${inv.id}` });
          }
          const selected = selId ? getInvoice(selId) : null;
          /* #805: default the two-pane detail to the first zinvoice so the
             pane has content on desktop load. isDefault keeps has-selection
             unset, so the single-pane (mobile) layout still opens on the
             list — the URL stays /invoices until the user picks one. */
          let shown = selected, isDefault = false;
          if (!shown) {
            const first = (qInvoices.all() as any[])[0];
            if (first) { shown = getInvoice(first.id); isDefault = !!shown; }
          }
          return html(invoicesPage(shown, shareOrigin(req), isDefault));
        }
        if (path === "/invoices/new" && method === "GET") {
          const sp = new URL(req.url).searchParams;
          const { p, preview } = prefillNewInvoice(sp);
          return html(invoiceNewPage(p, preview));
        }
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
            internal_notes: String(form.get("internal_notes") || ""),
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
          const items: { description: string; hours: number; rate: number; amount: number; entry_ids: number[]; date_from: string | null; date_to: string | null }[] = [];
          for (let i = 0; i < groups; i++) {
            const hours = round2(Number(form.get(`g${i}_hours`) || 0));
            const rate = round2(Number(form.get(`g${i}_rate`) || 0));
            const ids = String(form.get(`g${i}_ids`) || "").split(",").map(Number).filter(n => n > 0);
            if (hours <= 0) continue;
            items.push({
              /* #668: manual rows carry no entry ids (one-time work with no
                 tracked time) — their description defaults to "Item" while
                 auto rows keep the "Time" default. */
              description: String(form.get(`g${i}_desc`) || (ids.length ? "Time" : "Item")),
              hours, rate, amount: round2(hours * rate), entry_ids: ids,
              /* #243: per-line billing dates from the grouped entries */
              date_from: String(form.get(`g${i}_date_from`) || "") || null,
              date_to: String(form.get(`g${i}_date_to`) || "") || null,
            });
          }
          if (!items.length) return new Response("No line items — nothing to zinvoice.", { status: 400 });
          const number = String(form.get("number") || nextInvoiceNumber());
          if (db.query("SELECT 1 FROM invoices WHERE number = ?").get(number))
            return new Response("Zinvoice number already exists.", { status: 400 });
          const clientId = form.get("client_id") ? Number(form.get("client_id")) : null;
          const dueRaw = String(form.get("due_date") || "");
          const inv = db.query(
            `INSERT INTO invoices (client_id, number, issue_date, due_date, tax_rate, notes, internal_notes)
             VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
            .get(clientId, number, String(form.get("issue_date") || todayStr()),
                 dueRaw || null, Number(form.get("tax_rate") || 0), String(form.get("notes") || ""),
                 String(form.get("internal_notes") || "")) as any;
          const insItem = db.query(
            "INSERT INTO invoice_items (invoice_id, description, hours, rate, amount, date_from, date_to) VALUES (?, ?, ?, ?, ?, ?, ?)");
          const linkEntry = db.query("UPDATE time_entries SET invoice_id = ? WHERE id = ?");
          db.transaction(() => {
            for (const it of items) {
              insItem.run(inv.id, it.description, it.hours, it.rate, it.amount, it.date_from, it.date_to);
              for (const eid of it.entry_ids) linkEntry.run(inv.id, eid);
            }
          })();
          mintPublicToken(inv.id); /* #227: client link exists from birth */
          return new Response(null, { status: 302, headers: { Location: `/invoices?invoice=${inv.id}` } }); /* #364 */
        }
        m = path.match(/^\/invoices\/(\d+)$/);
        if (m && method === "GET") {
          /* #364: the standalone detail page is gone — old URLs land on the
             list-detail with the invoice selected. */
          const inv = getInvoice(Number(m[1]));
          return inv
            ? new Response(null, { status: 302, headers: { Location: `/invoices?invoice=${inv.id}` } })
            : html(notFoundPage(authedPage(req, TOKEN)), 404);
        }
        m = path.match(/^\/invoices\/(\d+)\.pdf$/);
        if (m && method === "GET") {
          const inv = getInvoice(Number(m[1]));
          if (!inv) return html(notFoundPage(authedPage(req, TOKEN)), 404);
          /* #609: the download button always generates a fresh PDF from the
             current invoice data. Any stored snapshot is deleted, not served. */
          const pdf = invoicePdf(invoicePdfInput(inv, shareOrigin(req)));
          db.query("UPDATE invoices SET pdf_snapshot = NULL WHERE id = ?").run(inv.id);
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
          /* #301: freeze the rendered document at send (re-frozen at paid for
             the status badge) — served verbatim from here on. */
          freezeInvoiceSnapshots(inv!.id, shareOrigin(req));
          /* #227: a sent invoice collects by default — create the Stripe payment
             link now. A Stripe failure never blocks the status transition; the
             detail page offers a retry. */
          if (want === "sent" && stripeConfigured()) { await stripeLinkFor(inv!.id); }
          if (isHtmx(req)) { const full = getInvoice(inv!.id); if (full) return html(invoiceDetailBody(full, shareOrigin(req)) + invoiceListOob(full.id)); } // #71, #364: +OOB list refresh
          return new Response(null, { status: 302, headers: { Location: `/invoices?invoice=${inv!.id}` } });
        }
        m = path.match(/^\/invoices\/(\d+)\/stripe-link$/);
        if (m && method === "POST") {
          const r = await stripeLinkFor(Number(m[1]));
          if (r.url) {
            if (isHtmx(req)) { const full = getInvoice(Number(m[1])); if (full) return html(invoiceDetailBody(full, shareOrigin(req))); } // #71
            return new Response(null, { status: 302, headers: { Location: `/invoices?invoice=${m[1]}` } });
          }
          return new Response(r.error || "Stripe error", { status: r.status || 500 });
        }
        m = path.match(/^\/invoices\/(\d+)\/public-token\/regenerate$/);
        if (m && method === "POST") {
          mintPublicToken(Number(m[1]));
          freezeInvoiceSnapshots(Number(m[1]), shareOrigin(req)); /* #606: new token -> re-freeze */
          if (isHtmx(req)) { const full = getInvoice(Number(m[1])); if (full) return html(invoiceDetailBody(full, shareOrigin(req))); } // #71
          return new Response(null, { status: 302, headers: { Location: `/invoices?invoice=${m[1]}` } });
        }
        m = path.match(/^\/invoices\/(\d+)\/public-token\/revoke$/);
        if (m && method === "POST") {
          db.query("UPDATE invoices SET public_token = NULL WHERE id = ?").run(Number(m[1]));
          freezeInvoiceSnapshots(Number(m[1]), shareOrigin(req)); /* #606: revoked link must leave the PDF */
          if (isHtmx(req)) { const full = getInvoice(Number(m[1])); if (full) return html(invoiceDetailBody(full, shareOrigin(req))); } // #71
          return new Response(null, { status: 302, headers: { Location: `/invoices?invoice=${m[1]}` } });
        }
        m = path.match(/^\/invoices\/(\d+)\/delete$/);
        if (m && method === "POST") {
          const inv = qInvoice.get(Number(m[1])) as Invoice | null;
          if (!inv) return html(notFoundPage(authedPage(req, TOKEN)), 404);
          if (inv.status !== "draft") return new Response("Only draft zinvoices can be deleted.", { status: 400 });
          db.transaction(() => {
            db.query("UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?").run(inv.id);
            db.query("DELETE FROM invoice_items WHERE invoice_id = ?").run(inv.id);
            db.query("DELETE FROM invoices WHERE id = ?").run(inv.id);
          })();
          return new Response(null, { status: 302, headers: { Location: "/invoices" } });
        }

          return html(notFoundPage(authedPage(req, TOKEN)), 404);
        } catch (err) {
          console.error(`[zimer] page ${method} ${path} threw:`, err);
          /* #733: tenant error page when there is one, else public chrome. */
          return html((tenant?.errorPage ?? publicError)(authedPage(req, TOKEN)), 500);
        }

    return null;
  }

  return { handleWeb };
}
