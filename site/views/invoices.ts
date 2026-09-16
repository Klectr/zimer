/** Invoice views: list page, new-invoice wizard (step 1 + step-2 fragment),
 *  template picker + invoice sheet, detail body fragment, and detail page.
 *  invoiceSheet is also returned so the public-views factory can reuse it. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, daysBetween, esc, money, round2, shortDateRange, termsDescription, termsKey, todayStr } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { getMeta } from "../db.ts";
import type { Invoice, InvoiceItem, NewInvParams } from "../lib/types.ts";

export interface InvoiceViewDeps {
  db: Database;
  qInvoices: Statement;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  clientOptions: (selected?: number | null) => string;
  getPublicToken: (id: number) => string | null;
  stripeConfigured: () => boolean;
  nextInvoiceNumber: () => string;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  statusPill: (status: string) => string;
  isOverdue: (row: { status: string; due_date?: string | null; client_payment_terms?: string | null }) => boolean;
}

export function createInvoiceViews(deps: InvoiceViewDeps) {
  const {
    db, qInvoices, layout, clientOptions,
    getPublicToken, stripeConfigured, nextInvoiceNumber, invoiceTotals, statusPill, isOverdue,
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
            <div class="md-text-field filled"><input type="date" name="issue_date" id="inv-issue" value="${esc(p.issue_date)}" required placeholder=" "><label>Issue date</label></div>
            <div class="md-text-field filled"><input type="date" name="due_date" id="inv-due" value="${esc(p.due_date)}" placeholder=" "><label>Due date</label></div>
          </div>
          <div class="md-text-field"><input type="text" name="notes" value="${esc(p.notes)}" placeholder=" "><label>Notes (optional)</label></div>
          <div class="row end"><button class="md-filled-button" type="submit">Preview line items</button></div>
        </form>
      </div>
      <script>(function(){
        var sel=document.getElementById('inv-client'), rate=document.getElementById('inv-rate'),
            issue=document.getElementById('inv-issue'), due=document.getElementById('inv-due');
        function addDaysStr(ymd,n){var p=ymd.split('-').map(Number);var d=new Date(p[0],p[1]-1,p[2]+n);
          return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
        /* #293: due date follows the selected client's terms (no HTMX
           round-trip — the days ride on data-terms-days). */
        function deriveDue(){
          var opt=sel.options[sel.selectedIndex];
          if(opt&&opt.dataset.termsDays&&issue.value&&due) due.value=addDaysStr(issue.value,parseInt(opt.dataset.termsDays,10));
        }
        sel.addEventListener('change',function(){
          var opt=sel.options[sel.selectedIndex];
          if(opt&&opt.dataset.rate&&!rate.value) rate.value=opt.dataset.rate;
          deriveDue();
        });
        if(issue) issue.addEventListener('change',deriveDue);
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
      ? `<div class="form-info">${icon("info")}<p>Entry durations are rounded up to ${preview.rounding}-minute increments.</p></div>`
      : "";
    const rows = preview.items.map((it, i) => `
        <tr>
          <td>${esc(shortDateRange(it.date_from, it.date_to))}</td>
          <td><input type="text" name="g${i}_desc" value="${esc(it.description)}" class="cell-input" aria-label="Item description"></td>
          <td><input type="number" name="g${i}_hours" value="${it.hours}" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>
          <td><input type="number" name="g${i}_rate" value="${it.rate}" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>
          <td class="num">${money(it.amount)}</td>
          <input type="hidden" name="g${i}_ids" value="${it.entry_ids.join(",")}">
          <input type="hidden" name="g${i}_date_from" value="${esc(it.date_from || "")}">
          <input type="hidden" name="g${i}_date_to" value="${esc(it.date_to || "")}">
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
            <thead><tr><th>Date</th><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr><td colspan="4">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
              <tr><td colspan="4">Tax (${esc(p.tax_rate)}%)</td><td class="num">${money(t.tax)}</td></tr>
              <tr class="grand"><td colspan="4">Total</td><td class="num">${money(t.total)}</td></tr>
            </tfoot>
          </table></div>
          <p class="muted tiny">Amounts recalculate on save. Entries are marked billed when the invoice is created.</p>
          <div class="row end"><button class="md-filled-button" type="submit">Create invoice</button></div>
        </form>
      </div>`;
  }

  /** /invoices/:id — printable detail with status actions. */
  function invoiceSheet(inv: Invoice & { items: InvoiceItem[] }): string {
    const t = invoiceTotals(inv.items, inv.tax_rate);
    const items = inv.items.map(it => `
      <tr>
        <td>${esc(shortDateRange(it.date_from, it.date_to))}</td>
        <td>${esc(it.description)}</td>
        <td class="num">${it.hours}</td>
        <td class="num">${money(it.rate)}</td>
        <td class="num">${money(it.amount)}</td>
      </tr>`).join("");
    const client = inv.client_name ? esc(inv.client_name) : "<em>No client</em>";
    const paidChip = inv.paid_via_stripe
      ? ` <span class="stripe-paid-chip" title="Marked paid automatically by a Stripe payment">⚡ Paid via Stripe</span>` : "";
    /* #243: billing period derives from the line-item dates. */
    const froms = inv.items.map(it => it.date_from).filter(Boolean).sort() as string[];
    const tos = inv.items.map(it => it.date_to || it.date_from).filter(Boolean).sort() as string[];
    const period = froms.length ? shortDateRange(froms[0], tos[tos.length - 1]) : "";
    /* #233/#239: single invoice design — dark band, badge, from/bill-to.
       Business profile comes from meta; empty profile hides the From block. */
    const bizName = getMeta(db, "business_name");
    const bizEmail = getMeta(db, "business_email");
    /* #289: the invoice client's own terms win; global business_payment_terms is fallback.
       #293: fixed list — print the canned description. */
    /* #295 wip: hide the due line when effective terms are pay-when-paid */
    const terms = termsDescription(termsKey(inv.client_payment_terms, getMeta(db, "business_payment_terms")));
    const head = `
        <div class="inv-modern-band">
          <div class="inv-modern-title">Invoice</div>
          <div class="inv-modern-right">
            <div class="inv-modern-number">${esc(inv.number)}</div>
            <div class="inv-modern-dates">Issued ${esc(inv.issue_date)}${inv.due_date ? ` · <strong>Due ${esc(inv.due_date)}</strong>` : ""}</div>
            ${period ? `<div class="inv-modern-dates">Billing period: ${esc(period)}</div>` : ""}
            <span class="inv-modern-badge${inv.status === "paid" ? " paid" : ""}">${inv.status === "paid" ? "Paid" : "Unpaid"}</span>${paidChip}
          </div>
        </div>
        <div class="inv-modern-parties">
          ${bizName || bizEmail ? `<div><div class="inv-modern-label">From</div>
            ${bizName ? `<div><strong>${esc(bizName)}</strong></div>` : ""}
            ${bizEmail ? `<div class="muted">${esc(bizEmail)}</div>` : ""}</div>` : ""}
          <div><div class="inv-modern-label">Bill to</div><div><strong>${client}</strong></div></div>
        </div>`;
    return `<div class="md-card invoice-sheet template-modern" id="invoice-sheet">
        ${head}
        <div class="table-wrap"><table class="md-table">
          <thead><tr><th>Date</th><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
          <tbody>${items || `<tr><td colspan="5" class="muted">No line items.</td></tr>`}</tbody>
          <tfoot>
            <tr><td colspan="4">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
            ${inv.tax_rate ? `<tr><td colspan="4">Tax (${inv.tax_rate}%)</td><td class="num">${money(t.tax)}</td></tr>` : ""}
            <tr class="grand"><td colspan="4">Total due</td><td class="num">${money(t.total)}</td></tr>
          </tfoot>
        </table></div>
        <p class="inv-terms">${esc(terms)}</p>
        ${inv.notes ? `<p class="inv-notes">${esc(inv.notes)}</p>` : ""}
      </div>`;
  }

  function invoiceDoc(inv: Invoice & { items: InvoiceItem[] }): string {
    return `<div id="invoice-doc">${invoiceSheet(inv)}</div>`;
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
    /* #229: compact single-line share rows — label + truncated URL, icon-only
       actions at the end, rendered after the invoice. The copy handler is
       delegated and id-free so htmx swaps stay safe. */
    const copyScript = `<script>(function(){
      function wire(sec){
        if (sec.dataset.copyWired) return;
        sec.dataset.copyWired = "1";
        sec.addEventListener("click", function(ev){
          var btn = ev.target.closest("[data-copy]");
          if (!btn || !btn.dataset.url) return;
          var done = function(){
            btn.classList.add("copied");
            setTimeout(function(){ btn.classList.remove("copied"); }, 1200);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(btn.dataset.url).then(done, done);
          else done();
        });
      }
      document.querySelectorAll(".share-lines").forEach(wire);
    })();</script>`;
    const copyBtn = (url: string) => `
      <button class="md-icon-button" type="button" data-copy data-url="${esc(url)}" title="Copy link" aria-label="Copy link">${icon("copy")}</button>`;
    const actBtn = (action: string, ic: string, label: string, cls = "", confirm = "") => `
      <form method="post" action="${action}" hx-post="${action}" ${hxDetail}>
        <button class="md-icon-button ${cls}" type="submit" title="${label}" aria-label="${label}"${confirm ? ` hx-confirm="${confirm}"` : ""}>${icon(ic)}</button>
      </form>`;
    const clientLine = clientLink ? `
      <div class="share-line">
        <span class="share-label">Client link</span>
        <span class="share-url" title="${esc(clientLink)}">${esc(clientLink)}</span>
        <span class="share-icons">
          ${copyBtn(clientLink)}
          ${actBtn(`/invoices/${inv.id}/public-token/regenerate`, "refresh", "Regenerate link (invalidates the old one)")}
          ${actBtn(`/invoices/${inv.id}/public-token/revoke`, "delete", "Revoke link", "danger", "Revoke the client link? The current URL will stop working.")}
        </span>
      </div>` : `
      <div class="share-line">
        <span class="share-label">Client link</span>
        <span class="share-icons">
          <form method="post" action="/invoices/${inv.id}/public-token/regenerate" hx-post="/invoices/${inv.id}/public-token/regenerate" ${hxDetail}>
            <button class="md-tonal-button" type="submit">${icon("add")}<span>Create client link</span></button>
          </form>
        </span>
      </div>`;
    /* #231: the Stripe payment row is gone from our UI — the public invoice
       page is the payment surface (it already renders Pay when a link
       exists). The link is still auto-created server-side on send. If that
       fails we show a one-line warning with a retry, so a missing Pay button
       can never fail silently. */
    const stripeWarn = (inv.status === "sent" && stripeConfigured() && !inv.stripe_payment_link) ? `
      <div class="share-line">
        <span class="share-label warn">Payment link</span>
        <span class="share-url">Couldn't create it — the client won't see a Pay button</span>
        <span class="share-icons">
          ${actBtn(`/invoices/${inv.id}/stripe-link`, "refresh", "Retry payment link")}
        </span>
      </div>` : "";
    const shareLines = `
      <section class="share-lines no-print" aria-label="Share">
        ${clientLine}
        ${stripeWarn}
        ${copyScript}
      </section>`;
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
      ${invoiceDoc(inv)}
      ${shareLines}</div>`;
  }

  function invoiceDetailPage(inv: Invoice & { items: InvoiceItem[] }, origin: string): string {
    /* #71: data-enter sits on the shell HTMX never replaces, so the entrance
       plays once per page load and never replays on swaps. */
    return layout(`Invoice ${inv.number}`, `
      <div data-enter="2" id="invoice-detail-wrap">${invoiceDetailBody(inv, origin)}</div>`, "invoices");
  }

  return {
    invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2,
    invoiceSheet, invoiceDoc, invoiceDetailBody, invoiceDetailPage,
  };
}
