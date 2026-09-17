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
import { resolve } from "node:path";
import { invoicePdf } from "./pdf.ts";
import { stripeConfigured, verifyWebhookSignature } from "./stripe.ts";
import { entryToJson, csvResponse, statusPill } from "./lib/format.ts";
import { json, html, isHtmx, publicOrigin } from "./lib/http.ts";
import { getToken, tokensEqual, authedApi, authedPage } from "./lib/auth.ts";
import { createDb, getMeta } from "./db.ts";
import { createRevenue } from "./lib/revenue.ts";
import { workspaceEmpty, demoIds, seedDemoData, removeDemoData, demoBanner } from "./lib/demo.ts";
import { createDomain, CAL_HOUR_PX, DAY_TARGET_SECS } from "./lib/domain.ts";
import { createLayoutViews } from "./views/layout.ts";
import { createPublicViews } from "./views/public.ts";
import { createTimerViews } from "./views/timer.ts";
import { createCalendarViews } from "./views/calendar.ts";
import { createManageViews } from "./views/manage.ts";
import { createInvoiceViews } from "./views/invoices.ts";
import { createApiRouter } from "./routes/api.ts";
import { createWebRouter } from "./routes/web.ts";

const PORT = Number(process.env.PORT || 3000);
/* #297: bind loopback by default — the app is self-hosted behind Tailscale or
   a reverse proxy; it must never listen on all interfaces unless asked. */
const HOST = process.env.HOST || "127.0.0.1";
/* #297: client-facing share links (PDF PAY ONLINE line, copy-link row) use
   this origin when set, so they print the public URL even when the PDF is
   downloaded over Tailscale. */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dir, "data");
const STATIC_DIR = resolve(import.meta.dir, "static");
mkdirSync(DATA_DIR, { recursive: true });

const TOKEN = getToken(DATA_DIR);

const {
  db, ENTRY_SELECT,
  qRunning, qOne, qRange, qInvoice, qInvoiceItems, qInvoices, qRevenueRows,
} = createDb(DATA_DIR);
const { revenueTotals, revenueMonthly, revenueByClient, isOverdue, revenueOverdue } =
  createRevenue(qRevenueRows, () => getMeta(db, "business_payment_terms"));
const { layout, notFoundPage, noSuchInvoicePage, rateLimitPage, errorPage } = createLayoutViews(qRunning);

const {
  getInvoice, invoiceTotals, nextInvoiceNumber, stripeLinkFor,
  unbilledEntries, groupToLineItems, clientRestFrom, unbilledByClient,
  projectOptions, m3ProgressBar, weekTargetBar,
  ensurePublicToken, getPublicToken, mintPublicToken,
} = createDomain({ db, qInvoice, qInvoiceItems, TOKEN });

const { timerPartial, todayPartial, dashboardPage } = createTimerViews({
  db, qRunning, qRange, layout, demoBanner, projectOptions,
  revenueTotals, revenueMonthly, revenueByClient, revenueOverdue, m3ProgressBar,
  dayTargetSecs: DAY_TARGET_SECS,
});
const { weekInner, weekGrid, calendarPage, editPage } = createCalendarViews({
  db, qOne, qRange, entrySelect: ENTRY_SELECT, layout, projectOptions, weekTargetBar,
  calHourPx: CAL_HOUR_PX,
});
const { manageCols, managePage, clientOptions, bizProfileSection } =
  createManageViews({ db, layout });
const {
  invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2, invoiceSheet,
  invoiceDoc, invoiceDetailBody, invoiceDetailPage,
  invoiceDocumentHtml, invoicePdfInput, /* #301 */
} = createInvoiceViews({
  db, qInvoices, layout, clientOptions,
  getPublicToken, stripeConfigured, nextInvoiceNumber, invoiceTotals, statusPill, isOverdue,
  unbilledByClient,
});
/* #301: freeze the rendered document at send time (re-frozen at the paid
   milestone for the status badge). Served verbatim afterwards. */
const freezeInvoiceSnapshots = (id: number, origin: string) => {
  const inv = getInvoice(id);
  if (!inv || inv.status === "draft") return;
  db.query("UPDATE invoices SET pdf_snapshot = ?, html_snapshot = ? WHERE id = ?")
    .run(invoicePdf(invoicePdfInput(inv, origin)), invoiceSheet(inv), id);
};
const { loginPage, publicInvoicePage, changelogPage } = createPublicViews({ /* #303: +changelogPage */
  getInvoice, invoiceTotals, invoiceDocumentHtml, ensurePublicToken,
});
const { handleApi } = createApiRouter({
  db, qRunning, qOne, qRange, qInvoice, qInvoices, TOKEN, authedApi, json,
  entryToJson, groupToLineItems, unbilledEntries, getInvoice,
  invoiceTotals, nextInvoiceNumber, mintPublicToken, stripeLinkFor, verifyWebhookSignature,
  revenueTotals, revenueMonthly, revenueByClient, revenueOverdue,
  freezeInvoiceSnapshots, shareOrigin: (req: Request) => PUBLIC_BASE_URL || publicOrigin(req, PORT), /* #301 */
});
const { handleWeb } = createWebRouter({
  db, qRunning, qOne, qRange, qInvoice, qInvoices,
  DATA_DIR, STATIC_DIR, TOKEN, authedPage, tokensEqual, html, json, csvResponse, isHtmx,
  shareOrigin: (req: Request) => PUBLIC_BASE_URL || publicOrigin(req, PORT),
  PORT, loginPage, publicInvoicePage, changelogPage, notFoundPage, noSuchInvoicePage, rateLimitPage, errorPage,
  dashboardPage, timerPartial, todayPartial, weekInner,
  calendarPage, editPage, manageCols, managePage, bizProfileSection, invoicesPage, invoiceNewPage,
  defaultNewInvParams, invoiceStep2, invoiceDetailPage, invoiceDetailBody, invoiceDoc,
  getInvoice, invoiceTotals,
  nextInvoiceNumber, stripeLinkFor, unbilledEntries,
  groupToLineItems, clientRestFrom, ensurePublicToken, getPublicToken, mintPublicToken,
  invoicePdf, stripeConfigured,
  invoicePdfInput, freezeInvoiceSnapshots, /* #301 */
  workspaceEmpty, demoIds, seedDemoData, removeDemoData, entryToJson,
});

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    return await handleApi(req, url, path, method)
      ?? await handleWeb(req, url, path, method)
      ?? html(notFoundPage(authedPage(req, TOKEN)), 404);
  },
});

console.log(`\n  ⏱ Timekeep running → http://${HOST}:${PORT}\n`);
