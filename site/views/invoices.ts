/** Invoice views: list page, new-invoice wizard (step 1 + step-2 fragment),
 *  template picker + invoice sheet, detail body fragment, and detail page.
 *  invoiceSheet is also returned so the public-views factory can reuse it. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, daysBetween, esc, money, round2, todayStr } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import type { Invoice, InvoiceItem, NewInvParams } from "../lib/types.ts";

export interface InvoiceTemplateInfo { id: string; name: string }

export interface InvoiceViewDeps {
  db: Database;
  qInvoices: Statement;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  clientOptions: (selected?: number | null) => string;
  getPublicToken: (id: number) => string | null;
  stripeConfigured: () => boolean;
  nextInvoiceNumber: () => string;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  templateList: () => InvoiceTemplateInfo[];
  statusPill: (status: string) => string;
  isOverdue: (row: { status: string; due_date?: string | null }) => boolean;
}

export function createInvoiceViews(deps: InvoiceViewDeps) {
  const {
    db, qInvoices, layout, clientOptions,
    getPublicToken, stripeConfigured, nextInvoiceNumber, invoiceTotals, templateList, statusPill, isOverdue,
  } = deps;

  function invoicesPage(): string {
    const rows = qInvoices.all() as any[];
    const outstanding = rows
      .filter(r => r.status !== "paid")
      .reduce((a, r) => a + r.subtotal * (1 + (r.tax_rate || 0) / 100), 0);
    const list = rows.length ? `<ul class="md-list">${rows.map(r => {
      const od = isOverdue(r) ? daysBetween(r.due_date as string, todayStr()) : 0;
      return `<li class="md-list-item">
        <div class="md-list-item-content">
          <div class="md-list-item-headline"><a href="/invoices/${r.id}" class="inv-link">${esc(r.number)}</a> ${statusPill(r.status)}${od ? ` <span class="attn-chip">${od}d overdue</span>` : ""}</div>
          <div class="md-list-item-supporting">${r.client_name ? esc(r.client_name) : "<em>No client</em>"} · issued ${esc(r.issue_date)}${r.due_date ? ` · due ${esc(r.due_date)}` : ""}</div>
        </div>
        <div class="md-list-item-trailing"><span class="dur">${money(round2(r.subtotal * (1 + (r.tax_rate || 0) / 100)))}</span></div>
      </li>`;
    }).join("")}</ul>` : `<p class="muted">No invoices yet. Create one from your tracked time.</p>`;
    return layout("Invoices", `
      <div class="page-head" data-enter="2">
        <h2 class="md-headline-small">Invoices</h2>
        <div class="page-head-actions">
          <a class="md-text-button" href="/export/invoices.csv" download>${icon("download")}Export CSV</a>
          <a class="md-filled-button" href="/invoices/new">${icon("add")}New invoice</a>
        </div>
      </div>
      ${rows.length ? `<p class="muted">Outstanding: <strong>${money(outstanding)}</strong></p>` : ""}
      <div class="scroll-region" data-enter="3">${list}</div>`, "invoices", true);
  }

  /* Milestone 20: NewInvParams type lives in lib/types.ts. */

  function defaultNewInvParams(): NewInvParams {
    const t = todayStr();
    return {
      client_id: "", from: addDays(t, -13), to: addDays(t, 1),
      rate: "", number: nextInvoiceNumber(), issue_date: t,
      due_date: addDays(t, 15), tax_rate: "0", notes: "",
    };
  }

  /** Step 1: pick client + date range. Step 2 (preview): editable line items. */
  function invoiceNewPage(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string }): string {
    const clients = db.query("SELECT id, name, rate FROM clients ORDER BY name").all() as any[];
    const selClient = clients.find(c => String(c.id) === p.client_id);
    const step1 = `
      <div class="md-card form-card">
        <h3 class="md-title-medium">1 · Pick unbilled time</h3>
        <div class="form-info">
          ${icon("info")}
          <p>Only finished, unbilled entries on this client's projects are included. Client hourly rates can be set on the <a href="/manage">Clients &amp; projects page</a>.</p>
        </div>
        <form method="post" action="/invoices/preview" class="form" hx-post="/invoices/preview" hx-target="#invoice-step2" hx-swap="innerHTML">
          <div class="md-text-field filled">
            <select name="client_id" id="inv-client" required aria-label="Client">
              <option value="">Choose a client…</option>${clientOptions(p.client_id ? Number(p.client_id) : null)}
            </select>
            <label>Client</label>
          </div>
          <div class="two-field">
            <div class="md-text-field filled"><input type="date" name="from" value="${esc(p.from)}" required placeholder=" "><label>From</label></div>
            <div class="md-text-field filled"><input type="date" name="to" value="${esc(p.to)}" required placeholder=" "><label>To (exclusive)</label></div>
          </div>
          <div class="two-field">
            <div class="md-text-field filled"><input type="number" name="rate" id="inv-rate" value="${esc(p.rate || (selClient ? String(selClient.rate || "") : ""))}" min="0" step="0.01" placeholder=" "><label>Hourly rate ($)</label></div>
            <div class="md-text-field filled"><input type="number" name="tax_rate" value="${esc(p.tax_rate)}" min="0" step="0.01" placeholder=" "><label>Tax %</label></div>
          </div>
          <div class="two-field">
            <div class="md-text-field"><input type="text" name="number" value="${esc(p.number)}" required placeholder=" "><label>Invoice number</label></div>
          </div>
          <div class="two-field">
            <div class="md-text-field filled"><input type="date" name="issue_date" value="${esc(p.issue_date)}" required placeholder=" "><label>Issue date</label></div>
            <div class="md-text-field filled"><input type="date" name="due_date" value="${esc(p.due_date)}" placeholder=" "><label>Due date</label></div>
          </div>
          <div class="md-text-field"><input type="text" name="notes" value="${esc(p.notes)}" placeholder=" "><label>Notes (optional)</label></div>
          <div class="row end"><button class="md-filled-button" type="submit">Preview line items</button></div>
        </form>
      </div>
      <script>(function(){
        var sel=document.getElementById('inv-client'), rate=document.getElementById('inv-rate');
        sel.addEventListener('change',function(){
          var opt=sel.options[sel.selectedIndex];
          if(opt&&opt.dataset.rate&&!rate.value) rate.value=opt.dataset.rate;
        });
      })();</script>`;


    return layout("New invoice", `
      <div class="page-narrow" data-enter="2">
      <div class="page-head">
        <h2 class="md-headline-small">New invoice</h2>
        <a class="md-text-button" href="/invoices">Cancel</a>
      </div>
      ${step1}<div id="invoice-step2">${invoiceStep2(p, preview)}</div>
      </div>`, "invoices");
  }

  /* #71: step-2 card as a fragment — the preview action swaps #invoice-step2 in place. */
  function invoiceStep2(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string; rounding?: number | null }): string {
    if (!preview) return "";
    if (preview.emptyMsg) {
      return `<div class="md-card form-card"><h3 class="md-title-medium">2 · Line items</h3><p class="muted">${esc(preview.emptyMsg)}</p></div>`;
    }
    const roundingNote = preview.rounding
      ? `<div class="form-info">${icon("info")}<p>Hours rounded up to ${preview.rounding}-minute increments per this client's billing rule.</p></div>`
      : "";
    const rows = preview.items.map((it, i) => `
        <tr>
          <td><input type="text" name="g${i}_desc" value="${esc(it.description)}" class="cell-input" aria-label="Item description"></td>
          <td><input type="number" name="g${i}_hours" value="${it.hours}" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>
          <td><input type="number" name="g${i}_rate" value="${it.rate}" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>
          <td class="num">${money(it.amount)}</td>
          <input type="hidden" name="g${i}_ids" value="${it.entry_ids.join(",")}">
        </tr>`).join("");
    const t = invoiceTotals(preview.items, Number(p.tax_rate) || 0);
    return `
      <div class="md-card form-card">
        <h3 class="md-title-medium">2 · Review line items</h3>
        ${roundingNote}
        <form method="post" action="/invoices" class="form">
          <input type="hidden" name="client_id" value="${esc(p.client_id)}">
          <input type="hidden" name="number" value="${esc(p.number)}">
          <input type="hidden" name="issue_date" value="${esc(p.issue_date)}">
          <input type="hidden" name="due_date" value="${esc(p.due_date)}">
          <input type="hidden" name="tax_rate" value="${esc(p.tax_rate)}">
          <input type="hidden" name="notes" value="${esc(p.notes)}">
          <input type="hidden" name="groups" value="${preview.items.length}">
          <div class="table-wrap"><table class="md-table">
            <thead><tr><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr><td colspan="3">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
              <tr><td colspan="3">Tax (${esc(p.tax_rate)}%)</td><td class="num">${money(t.tax)}</td></tr>
              <tr class="grand"><td colspan="3">Total</td><td class="num">${money(t.total)}</td></tr>
            </tfoot>
          </table></div>
          <p class="muted tiny">Amounts recalculate on save. Entries are marked billed when the invoice is created.</p>
          <div class="row end"><button class="md-filled-button" type="submit">Create invoice</button></div>
        </form>
      </div>`;
  }

  /** /invoices/:id — printable detail with status actions. */
  /** Template picker + invoice sheet, swapped live by HTMX when the template changes. */
  function templatePicker(inv: Invoice): string {
    const opts = templateList().map(t => `
      <button class="tpl-option${t.id === inv.template ? " selected" : ""}" type="button"
        hx-post="/invoices/${inv.id}/template" hx-vals='{"template":"${t.id}"}'
        hx-target="#invoice-doc" hx-swap="outerHTML swap:200ms" aria-pressed="${t.id === inv.template}">${esc(t.name)}</button>`).join("");
    return `<div class="template-picker no-print">
      <span class="md-label-medium muted">Template</span>
      <div class="tpl-options" role="group" aria-label="Invoice template">${opts}</div>
    </div>`;
  }

  function invoiceSheet(inv: Invoice & { items: InvoiceItem[] }): string {
    const t = invoiceTotals(inv.items, inv.tax_rate);
    const items = inv.items.map(it => `
      <tr>
        <td>${esc(it.description)}</td>
        <td class="num">${it.hours}</td>
        <td class="num">${money(it.rate)}</td>
        <td class="num">${money(it.amount)}</td>
      </tr>`).join("");
    const client = inv.client_name ? esc(inv.client_name) : "<em>No client</em>";
    const paidChip = inv.paid_via_stripe
      ? ` <span class="stripe-paid-chip" title="Marked paid automatically by a Stripe payment">⚡ Paid via Stripe</span>` : "";
    const datesClassic = `
        <div class="inv-dates">
          <div><span class="muted">Issued</span><br><strong>${esc(inv.issue_date)}</strong></div>
          ${inv.due_date ? `<div><span class="muted">Due</span><br><strong>${esc(inv.due_date)}</strong></div>` : ""}
        </div>`;
    const head = inv.template === "minimal" ? `
        <div class="inv-head-min">
          <div>
            <div class="md-label-medium muted">Invoice</div>
            <div class="md-title-large">${esc(inv.number)}</div>
            <div class="muted">${client}</div>
          </div>
          <div class="inv-meta">${statusPill(inv.status)}${paidChip}</div>
        </div>
        <div class="muted tiny inv-dates-min">Issued ${esc(inv.issue_date)}${inv.due_date ? ` · due ${esc(inv.due_date)}` : ""}</div>` : inv.template === "bold" ? `
        <div class="inv-head-bold">
          <div>
            <div class="inv-bold-title">Invoice</div>
            <div class="md-title-medium">${esc(inv.number)}</div>
            <div class="muted">${client}</div>
          </div>
          <div class="inv-meta">${statusPill(inv.status)}${paidChip}</div>
        </div>
        ${datesClassic}` : `
        <div class="inv-head">
          <div>
            <div class="md-headline-small">Invoice ${esc(inv.number)}</div>
            <div class="muted">${client}</div>
          </div>
          <div class="inv-meta">${statusPill(inv.status)}${paidChip}</div>
        </div>
        ${datesClassic}`;
    return `<div class="md-card invoice-sheet template-${esc(inv.template)}" id="invoice-sheet">
        ${head}
        <div class="table-wrap"><table class="md-table">
          <thead><tr><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
          <tbody>${items || `<tr><td colspan="4" class="muted">No line items.</td></tr>`}</tbody>
          <tfoot>
            <tr><td colspan="3">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
            ${inv.tax_rate ? `<tr><td colspan="3">Tax (${inv.tax_rate}%)</td><td class="num">${money(t.tax)}</td></tr>` : ""}
            <tr class="grand"><td colspan="3">Total due</td><td class="num">${money(t.total)}</td></tr>
          </tfoot>
        </table></div>
        ${inv.notes ? `<p class="inv-notes">${esc(inv.notes)}</p>` : ""}
      </div>`;
  }

  function invoiceDoc(inv: Invoice & { items: InvoiceItem[] }): string {
    return `<div id="invoice-doc">${templatePicker(inv)}${invoiceSheet(inv)}</div>`;
  }

  /* #71: detail body as a fragment — status/Stripe/link actions swap
     #invoice-detail in place instead of reloading the page. */
  function invoiceDetailBody(inv: Invoice & { items: InvoiceItem[] }, origin: string): string {
    const hxDetail = `hx-target="#invoice-detail" hx-swap="outerHTML"`;
    const next = inv.status === "draft" ? "sent" : inv.status === "sent" ? "paid" : null;
    const nextLabel = next === "sent" ? "Mark sent" : next === "paid" ? "Mark paid" : "";
    const t = invoiceTotals(inv.items, inv.tax_rate);
    const token = getPublicToken(inv.id);
    const clientLink = token ? `${origin}/i/${token}` : null;
    const shareSection = clientLink ? `
      <div class="stripe-row no-print">
        <span class="md-label-medium muted">Client link</span>
        <input class="link-input" id="client-link-url" readonly value="${esc(clientLink)}" onclick="this.select()" aria-label="Client invoice link">
        <button class="md-text-button" id="copy-client-link" type="button">${icon("copy")}<span>Copy</span></button>
        <form method="post" action="/invoices/${inv.id}/public-token/regenerate" class="inline" hx-post="/invoices/${inv.id}/public-token/regenerate" ${hxDetail}>
          <button class="md-text-button" type="submit" title="Create a new link (invalidates the old one)">${icon("refresh")}Regenerate</button>
        </form>
        <form method="post" action="/invoices/${inv.id}/public-token/revoke" class="inline" hx-post="/invoices/${inv.id}/public-token/revoke" ${hxDetail}>
          <button class="md-text-button danger" type="submit" hx-confirm="Revoke the client link? The current URL will stop working.">Revoke</button>
        </form>
        <script>(function(){var b=document.getElementById('copy-client-link');if(!b)return;var lbl=b.querySelector('span');b.addEventListener('click',function(){var i=document.getElementById('client-link-url');i.select();var done=function(){lbl.textContent='Copied';setTimeout(function(){lbl.textContent='Copy';},1500);};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(i.value).then(done,done);}else{document.execCommand('copy');done();}});})();</script>
      </div>` : `
      <div class="stripe-row no-print">
        <span class="md-label-medium muted">Client link</span>
        <form method="post" action="/invoices/${inv.id}/public-token/regenerate" class="inline" hx-post="/invoices/${inv.id}/public-token/regenerate" ${hxDetail}>
          <button class="md-text-button" type="submit">${icon("add")}Create client link</button>
        </form>
      </div>`;
    const stripeSection = inv.status !== "sent" ? "" : `
      <div class="stripe-row no-print">
        ${inv.stripe_payment_link ? `
          <span class="md-label-medium muted">Payment link</span>
          <input class="link-input" id="stripe-link-url" readonly value="${esc(inv.stripe_payment_link)}" onclick="this.select()" aria-label="Stripe payment link">
          <button class="md-text-button" id="copy-stripe-link" type="button">${icon("copy")}<span>Copy</span></button>
          <form method="post" action="/invoices/${inv.id}/stripe-link" class="inline" hx-post="/invoices/${inv.id}/stripe-link" ${hxDetail}>
            <button class="md-text-button" type="submit" title="Create a new payment link (replaces the old one)">${icon("refresh")}Regenerate</button>
          </form>
          <script>(function(){var b=document.getElementById('copy-stripe-link');if(!b)return;var lbl=b.querySelector('span');b.addEventListener('click',function(){var i=document.getElementById('stripe-link-url');i.select();var done=function(){lbl.textContent='Copied';setTimeout(function(){lbl.textContent='Copy';},1500);};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(i.value).then(done,done);}else{document.execCommand('copy');done();}});})();</script>`
        : stripeConfigured() ? `
          <form method="post" action="/invoices/${inv.id}/stripe-link" class="inline" hx-post="/invoices/${inv.id}/stripe-link" ${hxDetail}>
            <button class="md-filled-button" type="submit">${icon("card")}Collect via Stripe</button>
          </form>
          <span class="muted tiny">Creates a Stripe payment link for ${money(t.total)}.</span>` : `
          <span class="muted tiny">Set STRIPE_SECRET_KEY to collect via Stripe.</span>`}
      </div>`;
    return `<div id="invoice-detail">
      <div class="page-head no-print">
        <a class="md-text-button" href="/invoices">${icon("arrow_left")}Invoices</a>
        <div class="row">
          <a class="md-filled-button" href="/invoices/${inv.id}.pdf" download>${icon("download")}Download PDF</a>
          ${next ? `<form method="post" action="/invoices/${inv.id}/status" class="inline" hx-post="/invoices/${inv.id}/status" ${hxDetail}>
            <input type="hidden" name="status" value="${next}">
            <button class="md-filled-button" type="submit">${icon("check")}${nextLabel}</button>
          </form>` : ""}
          ${inv.status === "draft" ? `<form method="post" action="/invoices/${inv.id}/delete" class="inline">
            <button class="md-text-button danger" type="submit" onclick="return confirm('Delete this draft invoice? Its entries become unbilled again.')">Delete</button>
          </form>` : ""}
        </div>
      </div>
      ${shareSection}
      ${stripeSection}
      ${invoiceDoc(inv)}</div>`;
  }

  function invoiceDetailPage(inv: Invoice & { items: InvoiceItem[] }, origin: string): string {
    /* #71: data-enter sits on the shell HTMX never replaces, so the entrance
       plays once per page load and never replays on swaps. */
    return layout(`Invoice ${inv.number}`, `
      <div data-enter="2" id="invoice-detail-wrap">${invoiceDetailBody(inv, origin)}</div>`, "invoices");
  }

  return {
    invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2,
    templatePicker, invoiceSheet, invoiceDoc, invoiceDetailBody, invoiceDetailPage,
  };
}
