/** Invoice views: list page, new-invoice wizard (step 1 + step-2 fragment),
 *  template picker + invoice sheet, detail body fragment, and detail page.
 *  invoiceSheet is also returned so the public-views factory can reuse it. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, daysBetween, esc, fmtDur, money, round2, shortDateRange, shortYmd, termsDescription, termsKey, todayStr } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { getMeta } from "../db.ts";
import { workspaceEmpty } from "../lib/demo.ts"; /* #300: empty-state CTA */
import type { Invoice, InvoiceItem, NewInvParams } from "../lib/types.ts";
import type { PdfInvoice } from "../pdf.ts";

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
  unbilledByClient: () => { id: number; name: string; secs: number }[];
}

export function createInvoiceViews(deps: InvoiceViewDeps) {
  const {
    db, qInvoices, layout, clientOptions,
    getPublicToken, stripeConfigured, nextInvoiceNumber, invoiceTotals, statusPill, isOverdue,
    unbilledByClient,
  } = deps;

  /* #300: first-run empty state — a fresh install gets a one-click path to
     fictional sample data; everyone else gets straight to a new invoice. */
  function emptyInvoices(): string {
    const demoCta = workspaceEmpty(db) ? `
      <form method="post" action="/demo/load" class="inline">
        <button class="md-filled-button" type="submit">${icon("info")}<span>Load demo data</span></button>
      </form>` : "";
    return `<div class="empty-state" data-enter="3">
      ${icon("receipt")}
      <h3 class="md-title-large">No invoices yet</h3>
      <p class="muted">Turn tracked time into an invoice — or explore first with fictional sample data.</p>
      <div class="row">${demoCta}<a class="md-tonal-button" href="/invoices/new">${icon("add")}<span>New invoice</span></a></div>
    </div>`;
  }

  /* #364: one invoice row — the whole row is the tap target into the detail
     pane (two-pane, ≥840px) or the detail screen (single-pane). */
  function invoiceRow(r: any, selected: boolean): string {
    const od = isOverdue(r) ? daysBetween(r.due_date as string, todayStr()) : 0;
    return `<li class="md-list-item inv-row${selected ? " selected" : ""}">
      <a class="inv-row-hit" href="/invoices?invoice=${r.id}" aria-label="View invoice ${esc(r.number)}">
        <div class="md-list-item-content">
          <div class="md-list-item-headline">${esc(r.number)} ${statusPill(r.status)}${od ? ` <span class="attn-chip">${od}d overdue</span>` : ""}</div>
          <div class="md-list-item-supporting">${r.client_name ? esc(r.client_name) : "<em>No client</em>"} · issued ${esc(r.issue_date)}${r.due_date ? ` · due ${esc(r.due_date)}` : ""}${r.status === "paid" && r.paid_at ? ` · paid ${esc(shortYmd(r.paid_at))}` : ""}</div>
        </div>
        <div class="md-list-item-trailing"><span class="dur">${money(round2(r.subtotal * (1 + (r.tax_rate || 0) / 100)))}</span></div>
      </a>
    </li>`;
  }

  function outstandingTotal(rows: any[]): number {
    return rows
      .filter(r => r.status !== "paid")
      .reduce((a, r) => a + r.subtotal * (1 + (r.tax_rate || 0) / 100), 0);
  }

  function invoiceListHtml(rows: any[], selectedId: number | null): string {
    return `<ul class="md-list" id="inv-list">${rows.map(r => invoiceRow(r, selectedId === r.id)).join("")}</ul>`;
  }

  /* #364: out-of-band refresh for the list pane after a detail-pane action
     changes an invoice — the row pill and the outstanding total must not go
     stale. The action's invoice stays selected: the detail pane is showing it. */
  function invoiceListOob(selectedId: number): string {
    const rows = qInvoices.all() as any[];
    return `<ul class="md-list" id="inv-list" hx-swap-oob="true">${rows.map(r => invoiceRow(r, selectedId === r.id)).join("")}</ul>`
      + `<p class="muted" id="inv-outstanding" hx-swap-oob="true">Outstanding: <strong>${money(outstandingTotal(rows))}</strong></p>`;
  }

  function detailPlaceholder(): string {
    return `<div class="detail-placeholder">${icon("receipt")}<p class="muted">Select an invoice to preview it here.</p></div>`;
  }

  /* #364: M3 list-detail — the list pane owns the outstanding summary,
     unbilled time, and invoice rows; the detail pane shows the selected
     invoice (or a placeholder). Below 840px the panes take turns via
     .has-selection. */
  function invoicesPage(selected: (Invoice & { items: InvoiceItem[] }) | null, origin: string): string {
    const rows = qInvoices.all() as any[];
    const head = `
      <div class="page-head" data-enter="2">
        <h2 class="md-headline-small">Invoices</h2>
        <div class="page-head-actions">
          <a class="md-text-button" href="/export/invoices.csv" download>${icon("download")}Export CSV</a>
          <a class="md-filled-button" href="/invoices/new">${icon("add")}New invoice</a>
        </div>
      </div>`;
    if (!rows.length) {
      return layout("Invoices", `${head}
        <div class="scroll-region" data-enter="3">${emptyInvoices()}</div>`, "invoices", true);
    }
    return layout("Invoices", `${head}
      <div class="invoice-list-detail${selected ? " has-selection" : ""}" data-enter="3">
        <section class="invoice-list-pane" aria-label="Invoice list">
          <p class="muted" id="inv-outstanding">Outstanding: <strong>${money(outstandingTotal(rows))}</strong></p>
          ${unbilledSection(rows)}
          ${invoiceListHtml(rows, selected ? selected.id : null)}
        </section>
        <section class="invoice-detail-pane" id="invoice-detail-pane" aria-label="Invoice detail">
          ${selected ? invoiceDetailBody(selected, origin) : detailPlaceholder()}
        </section>
      </div>
      <script>(function(){
        /* #364: two-pane selection. At ≥840px a row click swaps the detail
           pane in place (the fragment pushes ?invoice=<id> and OOB-marks the
           selected row); below that the link navigates to the single-pane
           detail screen. Delegated so it survives the list's OOB swaps. */
        var wrap = document.querySelector(".invoice-list-detail");
        if (!wrap || !window.htmx) return;
        var mq = window.matchMedia("(min-width: 840px)");
        wrap.addEventListener("click", function(ev){
          var link = ev.target.closest(".inv-row-hit");
          if (!link || !mq.matches) return;
          ev.preventDefault();
          window.htmx.ajax("GET", link.getAttribute("href") + "&fragment=detail",
            { target: "#invoice-detail-pane", swap: "innerHTML" });
        });
      })();</script>`, "invoices", true);
  }

  /** #328: per-client finished, unbilled time with an "Invoice" shortcut into
      the "invoice the rest" prefill. Hidden when nothing is unbilled, and when
      the workspace has no invoices yet (the empty state owns that case). */
  function unbilledSection(rows: any[]): string {
    if (!rows.length) return "";
    const unbilled = unbilledByClient();
    if (!unbilled.length) return "";
    return `<h3 class="md-title-medium unbilled-head">Unbilled time</h3>
      <ul class="md-list">${unbilled.map(u => `
        <li class="md-list-item">
          <div class="md-list-item-content">
            <div class="md-list-item-headline">${esc(u.name)}</div>
            <div class="md-list-item-supporting">${fmtDur(u.secs)} unbilled</div>
          </div>
          <div class="md-list-item-trailing"><a class="md-text-button" href="/invoices/new?client_id=${u.id}">Invoice</a></div>
        </li>`).join("")}</ul>`;
  }

  /* Milestone 20: NewInvParams type lives in lib/types.ts. */

  function defaultNewInvParams(): NewInvParams {
    const t = todayStr();
    return {
      client_id: "", from: addDays(t, -13), to: addDays(t, 1),
      rate: "", number: nextInvoiceNumber(), issue_date: t,
      due_date: addDays(t, 15), tax_rate: "0", notes: "", internal_notes: "",
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
          <div class="two-field" id="inv-range">
            <div class="md-text-field filled"><input type="date" id="inv-from" name="from" value="${esc(p.from)}" required placeholder=" "><label>From</label></div>
            <div class="md-text-field filled"><input type="date" id="inv-to" name="to" value="${esc(p.to)}" required placeholder=" "><label>To (exclusive)</label></div>
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
          <div class="md-text-field"><input type="text" name="internal_notes" value="${esc(p.internal_notes)}" placeholder=" "><label>Internal notes (only you see this)</label></div>
          <div class="row end"><button class="md-filled-button" type="submit">Preview line items</button></div>
        </form>
      </div>
      <script>(function(){
        var sel=document.getElementById('inv-client'), rate=document.getElementById('inv-rate'),
            issue=document.getElementById('inv-issue'), due=document.getElementById('inv-due'),
            rangeEl=document.getElementById('inv-range'), rangeTouched=false;
        function addDaysStr(ymd,n){var p=ymd.split('-').map(Number);var d=new Date(p[0],p[1]-1,p[2]+n);
          return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
        /* #293: due date follows the selected client's terms (no HTMX
           round-trip — the days ride on data-terms-days). */
        function deriveDue(){
          var opt=sel.options[sel.selectedIndex];
          if(opt&&opt.dataset.termsDays&&issue.value&&due) due.value=addDaysStr(issue.value,parseInt(opt.dataset.termsDays,10));
        }
        /* #328: "invoice the rest" — a hand-edited range is never clobbered.
           Delegated on the wrapper so it survives the HTMX range swap. */
        if(rangeEl) rangeEl.addEventListener('change',function(){rangeTouched=true;});
        sel.addEventListener('change',function(){
          var opt=sel.options[sel.selectedIndex];
          if(opt&&opt.dataset.rate&&!rate.value) rate.value=opt.dataset.rate;
          deriveDue();
          if(sel.value&&!rangeTouched&&window.htmx)
            window.htmx.ajax('GET','/partial/invoice-rest?client_id='+encodeURIComponent(sel.value),{target:'#inv-range',swap:'innerHTML'});
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
          <input type="hidden" name="internal_notes" value="${esc(p.internal_notes)}">
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
       #293: fixed list — print the canned description.
       #295: pay-when-paid has no fixed due date, so the due line is suppressed. */
    const termsKey_ = termsKey(inv.client_payment_terms, getMeta(db, "business_payment_terms"));
    const terms = termsDescription(termsKey_);
    const head = `
        <div class="inv-modern-band">
          <div class="inv-modern-title">Invoice</div>
          <div class="inv-modern-right">
            <div class="inv-modern-number">${esc(inv.number)}</div>
            <div class="inv-modern-dates">Issued ${esc(inv.issue_date)}${inv.due_date && termsKey_ !== "pay_when_paid" ? ` · <strong>Due ${esc(inv.due_date)}</strong>` : ""}</div>
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
    return `<div id="invoice-doc">${invoiceDocumentHtml(inv)}</div>`;
  }

  /* #301: immutable invoices. The rendered document is frozen at send time
     (and re-frozen at the paid milestone for the status badge) and served
     verbatim afterwards — re-downloads are byte-identical. Pre-snapshot
     invoices lazy-freeze on first view after this ships. */
  function invoiceDocumentHtml(inv: Invoice & { items: InvoiceItem[] }): string {
    if (inv.html_snapshot) return inv.html_snapshot;
    const html = invoiceSheet(inv);
    if (inv.status !== "draft") {
      db.query("UPDATE invoices SET html_snapshot = ? WHERE id = ? AND html_snapshot IS NULL")
        .run(html, inv.id);
    }
    return html;
  }

  /* #301: single code path for the PDF input, shared by the download route
     and the send-time freeze. Extracted from the old inline route assembly. */
  function invoicePdfInput(inv: Invoice & { items: InvoiceItem[] }, origin: string): PdfInvoice {
    const t = invoiceTotals(inv.items, inv.tax_rate);
    /* #289/#293/#295: effective terms key drives the canned description
       and whether the PDF due line is shown. */
    const termsKey_ = termsKey(inv.client_payment_terms, getMeta(db, "business_payment_terms"));
    return {
      number: inv.number,
      status: inv.status,
      clientName: inv.client_name || "",
      issueDate: inv.issue_date,
      dueDate: inv.due_date,
      items: inv.items.map(it => ({
        description: it.description, hours: it.hours, rate: it.rate, amount: it.amount,
        dateFrom: it.date_from ?? null, dateTo: it.date_to ?? null, /* #243 */
      })),
      subtotal: t.subtotal, tax: t.tax, taxRate: inv.tax_rate, total: t.total,
      notes: inv.notes,
      fromName: getMeta(db, "business_name") || undefined,
      fromEmail: getMeta(db, "business_email") || undefined,
      fromAddress: getMeta(db, "business_address") || undefined,
      /* #243: payment terms, and the pay-online link.
         #289: the invoice client's own terms win; global is fallback.
         #293: fixed list — print the canned description.
         #295: pay-when-paid has no fixed due date — suppress the PDF due line. */
      terms: termsDescription(termsKey_),
      hideDue: termsKey_ === "pay_when_paid",
      payUrl: inv.public_token ? `${origin}/i/${inv.public_token}` : undefined,
    };
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
      /* #312: clipboard API or nothing. No execCommand fallback — if the
         platform can't copy (e.g. non-secure context), the button stays
         silent instead of faking success. */
      function wire(sec){
        if (sec.dataset.copyWired) return;
        sec.dataset.copyWired = "1";
        sec.addEventListener("click", function(ev){
          var btn = ev.target.closest("[data-copy]");
          if (!btn || !btn.dataset.url) return;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(btn.dataset.url).then(function(){
              btn.classList.add("copied");
              setTimeout(function(){ btn.classList.remove("copied"); }, 1200);
            }, function(){ /* copy failed: do nothing */ });
          }
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
    /* #302: internal-only notes live outside invoiceDoc (which also feeds the
       public page and print) — app surface only, never on client surfaces. */
    const internalBlock = inv.internal_notes ? `
      <aside class="internal-notes no-print" aria-label="Internal notes">
        <div class="internal-notes-label">Internal notes</div>
        <p>${esc(inv.internal_notes)}</p>
      </aside>` : "";
    const shareLines = `
      <section class="share-lines no-print" aria-label="Share">
        ${clientLine}
        ${stripeWarn}
        ${copyScript}
      </section>`;
    /* #420: the paid date is header metadata, not an action — it renders as an
       M3 assist chip (check icon + label) trailing the header row, so it reads
       as deliberate status metadata instead of stray text stuck to the back
       link. The actions row holds only actions. It stays out of the frozen
       invoice document (see #417). */
    return `<div id="invoice-detail">
      <div class="page-head no-print">
        <div class="invoice-detail-head">
          <a class="md-text-button detail-back" href="/invoices">${icon("arrow_left")}Invoices</a>
          ${inv.status === "paid" && inv.paid_at ? `<span class="md-chip">${icon("check")}Paid ${esc(shortYmd(inv.paid_at))}</span>` : ""}
        </div>
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
      ${internalBlock}
      ${shareLines}</div>`;
  }

  /* #364: list-detail replaced the standalone detail page — the detail body
     now renders inside the detail pane (or as the fragment the pane swaps). */
  return {
    invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2,
    invoiceSheet, invoiceDoc, invoiceDetailBody, invoiceListOob,
    invoiceDocumentHtml, invoicePdfInput, /* #301 */
  };
}
