#!/usr/bin/env bun
/**
 * Timekeep site — Bun + HTMX + SQLite. Zero npm dependencies.
 *
 *   cd site && bun server.ts
 *
 * Thin bootstrap: env, database, domain wiring, then route dispatch.
 * Views live in site/views/, routes in site/routes/, shared code in site/lib/.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Statement } from "bun:sqlite";
import { invoicePdf } from "./pdf.ts";
import { stripeConfigured, verifyWebhookSignature } from "./stripe.ts";
import { entryToJson, csvResponse, statusPill } from "./lib/format.ts";
import { json, html, isHtmx, publicOrigin, secureResponse } from "./lib/http.ts";
import { getToken, tokensEqual, authedApi, authedPage } from "./lib/auth.ts";
import { createAccountsDb } from "./lib/accounts.ts"; /* #732 */
import { createTenantStore } from "./lib/tenants.ts"; /* #733 */
import { backupAll, backupFreshness } from "./lib/backups.ts"; /* #730 part 2 */
import { createDb, getMeta, type DbBundle } from "./db.ts";
import { resourcePath } from "./lib/paths.ts"; /* #519 */
import { createRevenue } from "./lib/revenue.ts";
import { themeCss, themeKey } from "./lib/theme.ts"; /* #884 */
import { workspaceEmpty, demoIds, seedDemoData, removeDemoData, demoBanner } from "./lib/demo.ts";
import { createDomain, CAL_HOUR_PX, dayTargetSecs } from "./lib/domain.ts";
import { createLayoutViews } from "./views/layout.ts";
import { createPublicViews } from "./views/public.ts";
import { createLandingViews } from "./views/landing.ts"; /* #731 */
import { createTimerViews } from "./views/timer.ts";
import { createCalendarViews } from "./views/calendar.ts";
import { createManageViews } from "./views/manage.ts";
import { createInvoiceViews } from "./views/invoices.ts";
import { createApiRouter, type ApiTenant } from "./routes/api.ts"; /* #733: +ApiTenant */
import { createBillingRouter, createSubscriptionGate } from "./routes/billing.ts"; /* #728, #736 */
import { createLandingRouter } from "./routes/landing.ts"; /* #731 */
import { createWebRouter, type WebTenant } from "./routes/web.ts"; /* #733: +WebTenant */

const PORT = Number(process.env.PORT || 3000);
/* #297: bind loopback by default — the app is self-hosted behind Tailscale or
   a reverse proxy; it must never listen on all interfaces unless asked. */
const HOST = process.env.HOST || "127.0.0.1";
/* #297: client-facing share links (PDF PAY ONLINE line, copy-link row) use
   this origin when set, so they print the public URL even when the PDF is
   downloaded over Tailscale. */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dir, "data");
/* #519: static assets ship in the exe-relative resources dir in a compiled
   binary; dev/tarball runs keep the import.meta-relative dir. */
const STATIC_DIR = resourcePath("static", resolve(import.meta.dir, "static"));
mkdirSync(DATA_DIR, { recursive: true });

const TOKEN = getToken(DATA_DIR);

/* #732: hosted mode — multi-customer accounts. Self-host keeps the
   single shared token and never touches the accounts control plane. */
const HOSTED = process.env.HOSTED === "1";
const accounts = HOSTED ? createAccountsDb(DATA_DIR) : null;

/* #733: the full per-database app tree — every closure derived from one
   SQLite bundle (prepared queries, domain, revenue, views). Built once per
   tenant in hosted mode (lazily, on first authenticated request) and once
   globally in self-host mode. */
function buildTenantTree(bundle: DbBundle, dbPath: string): WebTenant & ApiTenant {
  const {
    db, ENTRY_SELECT,
    qRunning, qOne, qRange, qInvoice, qInvoiceItems, qInvoices, qRevenueRows,
  } = bundle;
  const { revenueTotals, revenueMonthly, revenueByClient, isOverdue, revenueOverdue } =
    createRevenue(qRevenueRows, () => getMeta(db, "business_payment_terms"));
  const { layout, notFoundPage, errorPage } = createLayoutViews(qRunning,
    /* #884: per-database accent theme; the tenant db owns the meta table. */
    () => themeCss(themeKey(getMeta(db, "theme"))));

  const {
    getInvoice, invoiceTotals, nextInvoiceNumber, stripeLinkFor,
    unbilledEntries, groupToLineItems, clientRestFrom, unbilledByClient,
    projectOptions, m3ProgressBar, weekTargetBar,
    ensurePublicToken, getPublicToken, mintPublicToken,
  } = createDomain({ db, qInvoice, qInvoiceItems, TOKEN });

  const { timerPartial, todayPartial, dashboardPage } = createTimerViews({
    db, qRunning, qRange, layout, demoBanner, projectOptions,
    revenueTotals, revenueMonthly, revenueByClient, revenueOverdue, m3ProgressBar,
    dayTargetSecs: () => dayTargetSecs(db), /* #908: per-request read of the user's setting */
  });
  const { weekInner, weekStrip, weekGrid, calendarPage, editPage, editEntryDialog } = createCalendarViews({
    db, qOne, qRange, entrySelect: ENTRY_SELECT, layout, projectOptions, weekTargetBar,
    calHourPx: CAL_HOUR_PX,
  });
  const { managePage, clientSelection, clientDetailBody, clientListOob, clientOptions, bizProfileSection, dailyTargetSection, clientSettingsForm, settingsPage, themeSectionHtml } =
    createManageViews({ db, layout });
  const {
    invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2, invoiceSheet,
    invoiceDoc, invoiceDetailBody, invoiceListOob,
    invoiceDocumentHtml, invoicePdfInput, /* #301 */
  } = createInvoiceViews({
    db, qInvoices, layout, clientOptions,
    getPublicToken, stripeConfigured, nextInvoiceNumber, invoiceTotals, statusPill, isOverdue,
    unbilledByClient,
  });
  /* #301: freeze the rendered HTML document at send time (re-frozen at the paid
     milestone for the status badge). Served verbatim afterwards.
     #609: the PDF is no longer frozen — downloads render fresh every time. */
  const freezeInvoiceSnapshots = (id: number, origin: string) => {
    const inv = getInvoice(id);
    if (!inv || inv.status === "draft") return;
    db.query("UPDATE invoices SET html_snapshot = ? WHERE id = ?")
      .run(invoiceSheet(inv), id);
  };
  const { publicInvoicePage } = createPublicViews({
    getInvoice, invoiceTotals, invoiceDocumentHtml, ensurePublicToken,
  });

  return {
    db, dbPath,
    qRunning, qOne, qRange, qInvoice, qInvoices,
    notFoundPage, errorPage,
    dashboardPage, timerPartial, todayPartial, weekInner, weekStrip,
    calendarPage, editPage, editEntryDialog,
    managePage, clientSelection, clientDetailBody, clientListOob, bizProfileSection, dailyTargetSection, clientSettingsForm, settingsPage, themeSectionHtml,
    invoicesPage, invoiceNewPage, defaultNewInvParams, invoiceStep2, invoiceDetailBody, invoiceListOob, invoiceDoc, publicInvoicePage,
    getInvoice, invoiceTotals,
    nextInvoiceNumber, stripeLinkFor, unbilledEntries,
    groupToLineItems, clientRestFrom, ensurePublicToken, getPublicToken, mintPublicToken,
    invoicePdfInput, freezeInvoiceSnapshots, /* #301 */
    revenueTotals, revenueMonthly, revenueByClient, revenueOverdue,
  };
}

/* #733: tenant resolution. Hosted: session → user → tenant tree, cached by
   user id; the tenant's SQLite file is created lazily on the first
   authenticated request. Self-host: the one global tree, always. */
const tenantStore = HOSTED
  ? createTenantStore<WebTenant & ApiTenant>(DATA_DIR, buildTenantTree)
  : null;
const getTenant: (req: Request) => (WebTenant & ApiTenant) | null = HOSTED
  ? (req: Request) => {
      const user = accounts!.sessionUserFromRequest(req);
      return user ? tenantStore!.get(user.id) : null;
    }
  : (() => {
      const tree = buildTenantTree(createDb(DATA_DIR), join(DATA_DIR, "timekeep.db"));
      return () => tree;
    })();
/* #741: cross-tenant routing for the sessionless surfaces (public invoice
   links, the Stripe webhook) — hosted only; self-host never needs it. */
const tenantById = HOSTED ? (userId: number) => tenantStore!.get(userId) : undefined;
const hostedDataDir = HOSTED ? DATA_DIR : undefined;

/* #733: pure public pages need no tenant — built once. The login/signup/
   changelog/terms/privacy renderers never touch the domain deps; the stubs
   throw if that ever changes. */
const unreachableDomain = (name: string) => () => {
  throw new Error(`#733: static public page called domain fn ${name}`);
};
const { loginPage, signupPage, hostedLoginPage, changelogPage, termsPage, privacyPage } = createPublicViews({
  getInvoice: unreachableDomain("getInvoice"),
  invoiceTotals: unreachableDomain("invoiceTotals"),
  invoiceDocumentHtml: unreachableDomain("invoiceDocumentHtml"),
  ensurePublicToken: unreachableDomain("ensurePublicToken"),
});
/* #733: public-chrome 404/500 + invoice-link dead-ends for the pre-auth
   paths. qRunning never fires on these pages; the authed (app-layout)
   variants live on each tenant tree. */
const { notFoundPage: publicNotFound, errorPage: publicError, noSuchInvoicePage, rateLimitPage } =
  createLayoutViews({ get: () => null } as unknown as Statement);
const { handleBilling, billing } = createBillingRouter({ /* #728: before handleWeb */
  HOSTED, accounts, json, html, verifyWebhookSignature, /* #736: html for the /billing wall */
  shareOrigin: (req: Request) => PUBLIC_BASE_URL || publicOrigin(req, PORT),
});
/* #736: hosted subscription gate — shared by the page and API routers. */
const { inactiveAuthedUser } = createSubscriptionGate({ HOSTED, accounts, billing });
const { handleApi } = createApiRouter({
  getTenant, TOKEN,
  /* #732: hosted API calls also accept a valid account session cookie. */
  authedApi: (req, token) =>
    authedApi(req, token) || (HOSTED && accounts!.sessionUserFromRequest(req) !== null),
  json,
  entryToJson, verifyWebhookSignature,
  shareOrigin: (req: Request) => PUBLIC_BASE_URL || publicOrigin(req, PORT), /* #301 */
  dataDir: hostedDataDir, tenantById, /* #741 */
  inactiveAuthedUser, /* #736 */
});
/* #731: hosted landing page for logged-out visitors on GET / — the same
   auth check web.ts uses for pages, so authed hosted users and self-host
   both fall through to handleWeb's existing behavior. */
const { landingPage } = createLandingViews(); /* #731 */
const visitorAuthed = (req: Request): boolean =>
  HOSTED ? accounts!.sessionUserFromRequest(req) !== null : authedPage(req, TOKEN);
const { handleLanding } = createLandingRouter({ hosted: HOSTED, visitorAuthed, landingPage, shareOrigin: (req: Request) => PUBLIC_BASE_URL || publicOrigin(req, PORT), /* #865 */ html }); /* #731 */
const { handleWeb } = createWebRouter({
  getTenant,
  STATIC_DIR, TOKEN, authedPage, tokensEqual, html, json, csvResponse, isHtmx,
  HOSTED, accounts, /* #732 */
  backupHealth: HOSTED ? () => backupFreshness(DATA_DIR) : null, /* #730 part 2 */
  shareOrigin: (req: Request) => PUBLIC_BASE_URL || publicOrigin(req, PORT),
  PORT, loginPage, signupPage, hostedLoginPage, changelogPage, termsPage, privacyPage, notFoundPage: publicNotFound, noSuchInvoicePage, rateLimitPage, errorPage: publicError,
  invoicePdf, stripeConfigured,
  workspaceEmpty, demoIds, seedDemoData, removeDemoData, entryToJson,
  inactiveAuthedUser, /* #736 */
  dataDir: hostedDataDir, tenantById, /* #741 */
});

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const res = await handleApi(req, url, path, method)
      ?? await handleBilling(req, url, path, method) /* #728 */
      ?? await handleLanding(req, url, path, method) /* #731 */
      ?? await handleWeb(req, url, path, method)
      /* #733: tenant's app-layout 404 when there is one, else public chrome. */
      ?? html((getTenant(req)?.notFoundPage ?? publicNotFound)(authedPage(req, TOKEN)), 404);
    return secureResponse(res, req); /* #910: security headers on every response */
  },
});

console.log(`\n  ⏱ Zimer running → http://${HOST}:${PORT}\n`);

/* #730 part 2: per-customer backups in hosted mode only. BACKUP_INTERVAL_HOURS
   (default 6) is overridable for tests; 0 disables the scheduler. One pass
   shortly after boot covers a restart window, then the interval repeats. */
if (HOSTED && Number(process.env.BACKUP_INTERVAL_HOURS ?? 6) > 0) {
  const backupHours = Number(process.env.BACKUP_INTERVAL_HOURS ?? 6);
  const runBackups = () => {
    try {
      const { tenants, accounts: acct, errors } = backupAll(DATA_DIR);
      console.log(`[backup] ${tenants.length} tenant(s), accounts ${acct ? "ok" : "n/a"}${errors.length ? ` — ERRORS: ${errors.join("; ")}` : ""}`);
    } catch (e) {
      console.error("[backup] pass failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(runBackups, 60_000);
  setInterval(runBackups, backupHours * 3600_000);
}
