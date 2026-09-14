/** Public views: login page, public invoice page, client portal page.
 *  The invoice-reading helpers (getInvoice, invoiceTotals, invoiceSheet,
 *  ensurePublicToken) stay owned by server.ts until the invoices view slice
 *  (#171) and are injected here, so these pages render unchanged. */

import type { Database } from "bun:sqlite";
import { esc, money, statusPill } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import type { Invoice, InvoiceItem } from "../lib/types.ts";

export interface PublicViewDeps {
  db: Database;
  getInvoice: (id: number) => (Invoice & { items: InvoiceItem[] }) | null;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  invoiceSheet: (inv: Invoice & { items: InvoiceItem[] }) => string;
  ensurePublicToken: (id: number) => string;
}

export function createPublicViews(deps: PublicViewDeps) {
  const { db, getInvoice, invoiceTotals, invoiceSheet, ensurePublicToken } = deps;

  /** Public client invoice page: no auth, read-only, no actions or navigation. */
  function publicInvoicePage(inv: Invoice & { items: InvoiceItem[] }): string {
    const t = invoiceTotals(inv.items, inv.tax_rate);
    const pay = inv.stripe_payment_link ? `
      <div class="no-print public-pay">
        <a class="md-filled-button public-pay-btn" href="${esc(inv.stripe_payment_link)}" target="_blank" rel="noopener">${icon("card")}<span>Pay ${money(t.total)}</span></a>
      </div>` : "";
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Invoice ${esc(inv.number)} · Timekeep</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/static/style.css">
  <script src="/static/motion.js" defer></script>
  </head>
  <body>
  <main class="page-public-invoice">
  ${invoiceSheet(inv)}
  ${pay}
  <p class="muted tiny no-print public-foot">Shared securely via Timekeep</p>
  </main>
  </html>`;
  }

  /** Milestone 12: public per-client portal — all invoices, statuses, payment history. Read-only. */
  function portalPage(client: any): string {
    const rows = db.query("SELECT id FROM invoices WHERE client_id = ? ORDER BY issue_date DESC").all(client.id) as any[];
    const invs = rows.map(r => getInvoice(r.id)!).filter(Boolean);
    const outstanding = invs.filter(i => i.status !== "paid")
      .reduce((a, i) => a + invoiceTotals(i.items, i.tax_rate).total, 0);
    const paid = invs.filter(i => i.status === "paid");
    const row = (i: any) => {
      const t = invoiceTotals(i.items, i.tax_rate);
      const link = `/i/${ensurePublicToken(i.id)}`;
      return `<li class="md-list-item">
        <div class="md-list-item-content">
          <div class="md-list-item-headline"><a href="${link}" class="inv-link">${esc(i.number)}</a> ${statusPill(i.status)}</div>
          <div class="md-list-item-supporting">issued ${esc(i.issue_date)}${i.due_date ? ` · due ${esc(i.due_date)}` : ""}${i.status === "paid" && i.paid_at ? ` · paid ${esc(i.paid_at)}` : ""}</div>
        </div>
        <div class="md-list-item-trailing"><span class="dur">${money(t.total)}</span></div>
      </li>`;
    };
    const open = invs.filter(i => i.status !== "paid");
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(client.name)} · Client portal · Timekeep</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/static/style.css">
  </head>
  <body>
  <main class="page-public-invoice">
    <div class="portal-head">
      <p class="md-label-large muted">Client portal</p>
      <h1 class="md-headline-medium">${esc(client.name)}</h1>
      <p class="md-title-large">Outstanding balance: <strong>${money(outstanding)}</strong></p>
    </div>
    <h2 class="md-title-medium">Open invoices</h2>
    ${open.length ? `<ul class="md-list">${open.map(row).join("")}</ul>` : `<p class="muted">Nothing open — all caught up.</p>`}
    <h2 class="md-title-medium">Payment history</h2>
    ${paid.length ? `<ul class="md-list">${paid.map(row).join("")}</ul>` : `<p class="muted">No payments yet.</p>`}
    <p class="muted tiny public-foot">Shared securely via Timekeep</p>
  </main>
  </html>`;
  }

  function loginPage(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Log in · Timekeep</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/static/style.css">
  <script src="/static/motion.js" defer></script></head>
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

  return { loginPage, publicInvoicePage, portalPage };
}
