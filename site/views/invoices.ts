/** Invoice views: list page, new-invoice wizard (step 1 + step-2 fragment),
 *  template picker + invoice sheet, detail body fragment, and detail page.
 *  invoiceSheet is also returned so the public-views factory can reuse it. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, daysBetween, esc, fmtDur, money, round2, shortDateRange, shortDateRangeYear, shortYmd, termsDescription, termsKey, todayStr } from "../lib/format.ts";
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

  /* #526: both line-item tables (the new-invoice preview and the rendered
     sheet) share one header row — scope="col" lets screen readers announce
     the column ("Hours", "Rate", "Amount") for each numeric cell. */
  function itemHead(): string {
    return `<tr><th scope="col">Date</th><th scope="col">Description</th>` +
      `<th scope="col" class="num">Hours</th><th scope="col" class="num">Rate</th>` +
      `<th scope="col" class="num">Amount</th></tr>`;
  }

  /* #300: first-run empty state — a fresh install gets a one-click path to
     fictional sample data; everyone else gets straight to a new invoice.
     #586: the header already has the gold New invoice button, so the empty
     state doesn't repeat it — no duplicate CTAs on one page. */
  function emptyInvoices(): string {
    const demoCta = workspaceEmpty(db) ? `
      <form method="post" action="/demo/load" class="inline">
        <button class="md-filled-button" type="submit">${icon("info")}<span>Load demo data</span></button>
      </form>` : "";
    return `<div class="empty-state" data-enter="3">
      ${icon("pumpkin")}
      <h3 class="md-title-large">No invoices yet</h3>
      <p class="muted">Turn tracked time into an invoice — or explore first with fictional sample data.</p>
      <div class="row">${demoCta}</div>
    </div>`;
  }

  /* #364: one invoice row — the whole row is the tap target into the detail
     pane (two-pane, ≥840px) or the detail screen (single-pane). */
  function invoiceRow(r: any, selected: boolean): string {
    const od = isOverdue(r) ? daysBetween(r.due_date as string, todayStr()) : 0;
    /* #442: keep each date phrase on one line so the narrow list pane wraps
       at the middots instead of splitting "2026-" from "10-09". #481: the
       middot is a leading separator INSIDE the nowrap span — it used to sit
       in the raw text between spans, dangling at the end of the broken line
       ("issued 2026-09-24 ·" / "due 2026-10-09"). Wraps now happen before
       a middot, never after one. #588: long client names broke between the
       segments instead ("Northwind Traders · issued Sep 28" / "· due Oct 13").
       The segments now sit inside one nowrap .inv-dates group, so the wrap
       lands between the client name and the dates, never before a middot. */
    const seg = (label: string, val: string) => `<span class="inv-date">· ${label} ${esc(val)}</span>`;
    const dates = `${seg("issued", shortYmd(r.issue_date))}${r.due_date ? ` ${seg("due", shortYmd(r.due_date))}` : ""}${r.status === "paid" && r.paid_at ? ` ${seg("paid", shortYmd(r.paid_at))}` : ""}`;
    return `<li class="md-list-item inv-row${selected ? " selected" : ""}">
      <a class="inv-row-hit" href="/invoices?invoice=${r.id}" aria-label="View invoice ${esc(r.number)}">
        <div class="md-list-item-content">
          <div class="md-list-item-headline">${esc(r.number)} ${statusPill(r.status)}${od ? ` <span class="attn-chip">${od}d overdue</span>` : ""}</div>
          <div class="md-list-item-supporting">${r.client_name ? esc(r.client_name) : "<em>No client</em>"} <span class="inv-dates">${dates}</span></div>
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
        <h1 class="md-headline-small">Invoices</h1>
        <div class="page-head-actions">
          ${rows.length ? `<a class="md-text-button" href="/export/invoices.csv" download>${icon("download")}Export CSV</a>` : ""}
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
            { target: "#invoice-detail-pane", swap: "innerHTML scroll:top" });
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
          <p>Only finished, unbilled entries on this client's projects are included. Client hourly rates can be set on the <a href="/manage">Clients page</a>.</p>
        </div>
        <form method="post" action="/invoices/preview" class="form" hx-post="/invoices/preview" hx-target="#invoice-step2" hx-swap="innerHTML">
          <div class="md-text-field filled">
            <select name="client_id" id="inv-client" required aria-label="Client">
              <option value="">Choose a client…</option>${clientOptions(p.client_id ? Number(p.client_id) : null)}
            </select>
            <label>Client</label>
          </div>
          <div class="two-field" id="inv-range">
            <div class="md-text-field filled"><input type="date" id="inv-from" name="from" value="${esc(p.from)}" required placeholder=" "><label for="inv-from">From</label></div>
            <div class="md-text-field filled"><input type="date" id="inv-to" name="to" value="${esc(p.to)}" required placeholder=" "><label for="inv-to">To</label></div>
          </div>
          <div class="two-field">
            <div class="md-text-field filled has-prefix"><span class="affix prefix" aria-hidden="true">$</span><input type="number" name="rate" id="inv-rate" value="${esc(p.rate || (selClient ? String(selClient.rate || "") : ""))}" min="0" step="0.01" placeholder=" " aria-label="Hourly rate"><label>Hourly rate</label></div>
            <div class="md-text-field filled has-suffix"><input type="number" name="tax_rate" value="${esc(p.tax_rate)}" min="0" step="0.01" placeholder=" " aria-label="Tax"><label>Tax</label><span class="affix suffix" aria-hidden="true">%</span></div>
          </div>
          <div class="two-field">
            <div class="md-text-field"><input type="text" id="inv-number" name="number" value="${esc(p.number)}" required placeholder=" "><label for="inv-number">Invoice number</label></div>
          </div>
          <div class="two-field">
            <div class="md-text-field filled"><input type="date" name="issue_date" id="inv-issue" value="${esc(p.issue_date)}" required placeholder=" "><label for="inv-issue">Issue date</label></div>
            <div class="md-text-field filled"><input type="date" name="due_date" id="inv-due" value="${esc(p.due_date)}" placeholder=" "><label for="inv-due">Due date</label></div>
          </div>
          <div class="md-text-field"><input type="text" name="notes" value="${esc(p.notes)}" placeholder=" " aria-label="Notes (optional)"><label>Notes (optional)</label></div>
          <div class="md-text-field"><input type="text" name="internal_notes" value="${esc(p.internal_notes)}" placeholder=" " aria-label="Internal notes (only you see this)"><label>Internal notes (only you see this)</label></div>
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
        /* #668: manual line items — the Add button appends an editable row
           to the step-2 table and bumps the groups count the POST handler
           reads. Delegated on document so it survives the HTMX step-2 swap;
           inputs are looked up within the button's own form (never by id —
           #215), and hidden inputs stay inside the td (#536). */
        document.addEventListener('click',function(ev){
          var btn=ev.target.closest('[data-add-item]');
          if(!btn) return;
          var form=btn.closest('form');
          if(!form) return;
          var groups=form.querySelector('input[name="groups"]');
          var body=form.querySelector('tbody');
          if(!groups||!body) return;
          var i=parseInt(groups.value,10)||0;
          var tr=document.createElement('tr');
          tr.innerHTML=
            '<td></td>'+
            '<td><input type="text" name="g'+i+'_desc" class="cell-input" aria-label="Item description"></td>'+
            '<td><input type="number" name="g'+i+'_hours" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>'+
            '<td><input type="number" name="g'+i+'_rate" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>'+
            '<td class="num"><input type="hidden" name="g'+i+'_ids" value="">'+
            '<input type="hidden" name="g'+i+'_date_from" value="">'+
            '<input type="hidden" name="g'+i+'_date_to" value=""></td>';
          body.appendChild(tr);
          groups.value=String(i+1);
          var desc=tr.querySelector('input[name="g'+i+'_desc"]');
          if(desc) desc.focus();
        });
      })();</script>`;


    return layout("New invoice", `
      <div class="page-narrow" data-enter="2">
      <div class="page-head">
        <h1 class="md-headline-small">New invoice</h1>
        <a class="md-text-button" href="/invoices">Cancel</a>
      </div>
      ${step1}<div id="invoice-step2">${invoiceStep2(p, preview)}</div>
      </div>`, "invoices");
  }

  /* #71: step-2 card as a fragment — the preview action swaps #invoice-step2 in place. */
  function invoiceStep2(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string; rounding?: number | null }): string {
    if (!preview) return "";
    const roundingNote = preview.rounding
      ? `<div class="form-info">${icon("info")}<p>Entry durations are rounded up to ${preview.rounding}-minute increments.</p></div>`
      : "";
    /* #668: no unbilled entries used to be a dead end — the wizard now
       offers manual line items instead, so one-time (untracked) work can
       be invoiced without inventing time entries. */
    const emptyNote = preview.emptyMsg
      ? `<div class="form-info">${icon("info")}<p>${esc(preview.emptyMsg)}</p></div>`
      : "";
    const rows = preview.items.map((it, i) => `
        <tr>
          <td>${esc(shortDateRange(it.date_from, it.date_to))}</td>
          <td><input type="text" name="g${i}_desc" value="${esc(it.description)}" class="cell-input" aria-label="Item description"></td>
          <td><input type="number" name="g${i}_hours" value="${it.hours}" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>
          <td><input type="number" name="g${i}_rate" value="${it.rate}" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>
          <td class="num">${money(it.amount)}<input type="hidden" name="g${i}_ids" value="${it.entry_ids.join(",")}"><input type="hidden" name="g${i}_date_from" value="${esc(it.date_from || "")}"><input type="hidden" name="g${i}_date_to" value="${esc(it.date_to || "")}"></td>
        </tr>`).join("");
    const t = invoiceTotals(preview.items, Number(p.tax_rate) || 0);
    return `
      <div class="md-card form-card">
        <h3 class="md-title-medium">2 · Review line items</h3>
        ${emptyNote}
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
            <thead>${itemHead()}</thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr><td colspan="4">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
              <tr><td colspan="4">Tax (${esc(p.tax_rate)}%)</td><td class="num">${money(t.tax)}</td></tr>
              <tr class="grand"><td colspan="4">Total</td><td class="num">${money(t.total)}</td></tr>
            </tfoot>
          </table></div>
          <div class="row"><button type="button" class="md-text-button" data-add-item>${icon("add")}<span>Add line item</span></button></div>
          <p class="muted tiny">Amounts recalculate on save. Entries are marked billed when the invoice is created.</p>
          <div class="row end"><button class="md-filled-button" type="submit">Create invoice</button></div>
        </form>
      </div>`;
  }

  /** /invoices/:id — printable detail with status actions. */
  function invoiceSheet(inv: Invoice & { items: InvoiceItem[] }): string {
    const t = invoiceTotals(inv.items, inv.tax_rate);
    /* #679: the phone-stacked layout appends its "×" suffix via CSS — mark
       the singular hour so it reads "1 hr", not "1 hrs". */
    const items = inv.items.map(it => `
      <tr>
        <td class="inv-date">${esc(shortDateRange(it.date_from, it.date_to))}</td>
        <td class="desc">${esc(it.description)}</td>
        <td class="num inv-hours${it.hours === 1 ? " inv-hours-1" : ""}">${it.hours}</td>
        <td class="num inv-rate">${money(it.rate)}</td>
        <td class="num inv-amount">${money(it.amount)}</td>
      </tr>`).join("");
    const client = inv.client_name ? esc(inv.client_name) : "<em>No client</em>";
    /* #627: Bill-to block picks up the client address (multi-line) and
       email under the name; blank when the record has none. */
    const billToLines = [
      ...(inv.client_address ? inv.client_address.split("\n").map(l => l.trim()).filter(Boolean) : []),
      ...(inv.client_email ? [inv.client_email.trim()] : []),
    ].map(l => `<div class="muted">${esc(l)}</div>`).join("");
    /* #448: bolt comes from the icon system, not an emoji — the chip is
       otherwise untouched (same spot, same styling, same label).
       #494: no native title — "Paid via Stripe" already says what the
       title="Marked paid automatically by a Stripe payment" restated. */
    const paidChip = inv.paid_via_stripe
      ? ` <span class="stripe-paid-chip">${icon("bolt")}<span>Paid via Stripe</span></span>` : "";
    /* #243: billing period derives from the line-item dates.
       #582: year-aware ("Sep 1 – Sep 28, 2026"), matching the PDF, so the
       period is never ambiguous across year boundaries. */
    const froms = inv.items.map(it => it.date_from).filter(Boolean).sort() as string[];
    const tos = inv.items.map(it => it.date_to || it.date_from).filter(Boolean).sort() as string[];
    const period = froms.length ? shortDateRangeYear(froms[0], tos[tos.length - 1]) : "";
    /* #233/#239: single invoice design — dark band, badge, from/bill-to.
       Business profile comes from meta; empty profile hides the From block. */
    const bizName = getMeta(db, "business_name");
    const bizEmail = getMeta(db, "business_email");
    /* #289: the invoice client's own terms win; global business_payment_terms is fallback.
       #293: fixed list — print the canned description.
       #295: pay-when-paid has no fixed due date, so the due line is suppressed. */
    const termsKey_ = termsKey(inv.client_payment_terms, getMeta(db, "business_payment_terms"));
    const terms = termsDescription(termsKey_);
    /* #612: the issued/billing dates move out of the header band.
       #615: they sit directly above the table headers, i.e. below the
       parties row. The #560 nowrap treatment (each phrase in its own
       .inv-date span, middot as a leading separator) carries over. */
    /* #656: the middot separators are their own spans so the dates can
       stack cleanly on phones (separators hidden there); desktop keeps the
       same inline rendering via .inv-date-sep margins. */
    const sep = `<span class="inv-date-sep" aria-hidden="true">·</span>`;
    const datesLine = `<div class="inv-dates-line muted"><span class="inv-date">Issued ${esc(shortYmd(inv.issue_date))}</span>${inv.due_date && termsKey_ !== "pay_when_paid" ? `${sep}<span class="inv-date"><strong>Due ${esc(shortYmd(inv.due_date))}</strong></span>` : ""}${period ? `${sep}<span class="inv-date">Billing period: ${esc(period)}</span>` : ""}</div>`;
    const head = `
        <div class="inv-modern-band">
          <div class="inv-modern-title">Invoice</div>
          <div class="inv-modern-right">
            <div class="inv-modern-number">${esc(inv.number)}</div>
            <span class="inv-modern-badge${inv.status === "paid" ? " paid" : ""}">${inv.status === "paid" ? "Paid" : "Unpaid"}</span>${paidChip}
          </div>
        </div>
        <div class="inv-modern-parties">
          <div><div class="inv-modern-label">Bill to</div><div><strong>${client}</strong></div>${billToLines}</div>
          ${bizName || bizEmail ? `<div class="inv-from"><div class="inv-modern-label">From</div>
            ${bizName ? `<div><strong>${esc(bizName)}</strong></div>` : ""}
            ${bizEmail ? `<div class="muted">${esc(bizEmail)}</div>` : ""}</div>` : ""}
        </div>
        ${datesLine}`;
    return `<div class="md-card invoice-sheet template-modern" id="invoice-sheet">
        ${head}
        <div class="table-wrap"><table class="md-table">
          <thead>${itemHead()}</thead>
          <tbody>${items || `<tr><td colspan="5" class="muted">No line items.</td></tr>`}</tbody>
          <tfoot>
            <tr><td colspan="4">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
            ${inv.tax_rate ? `<tr><td colspan="4">Tax (${inv.tax_rate}%)</td><td class="num">${money(t.tax)}</td></tr>` : ""}
            <tr class="grand"><td colspan="4">${inv.status === "paid" ? "Total" : "Total due"}</td><td class="num">${money(t.total)}</td></tr>
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
      clientAddress: inv.client_address || undefined, /* #627 */
      clientEmail: inv.client_email || undefined, /* #627 */
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
         #295: pay-when-paid has no fixed due date — suppress the PDF due line.
         #639: paid invoices have nothing left to pay — drop the link. */
      terms: termsDescription(termsKey_),
      hideDue: termsKey_ === "pay_when_paid",
      payUrl: inv.public_token && inv.status !== "paid" ? `${origin}/i/${inv.public_token}` : undefined,
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
      /* #621: the Clipboard API only exists in secure contexts, but the app
         is served over plain HTTP on the Tailscale IP — so fall back to the
         legacy execCommand path there instead of silently doing nothing. */
      function copyText(text, done){
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function(){ legacyCopy(text, done); });
        } else {
          legacyCopy(text, done);
        }
      }
      function legacyCopy(text, done){
        var ta = document.createElement(\"textarea\");
        ta.value = text;
        ta.setAttribute(\"readonly\", \"\");
        ta.style.position = \"fixed\";
        ta.style.opacity = \"0\";
        document.body.appendChild(ta);
        ta.select();
        try { if (document.execCommand(\"copy\")) done(); } catch (e) { /* keep it honest: no fake success */ }
        document.body.removeChild(ta);
      }
      function wire(sec){
        if (sec.dataset.copyWired) return;
        sec.dataset.copyWired = \"1\";
        sec.addEventListener(\"click\", function(ev){
          var btn = ev.target.closest(\"[data-copy]\");
          if (!btn || !btn.dataset.url) return;
          copyText(btn.dataset.url, function(){
            btn.classList.add(\"copied\");
            setTimeout(function(){ btn.classList.remove(\"copied\"); }, 1200);
          });
        });
      }
      document.querySelectorAll(\".share-lines\").forEach(wire);
    })();</script>`;
    const copyBtn = (url: string) => `
      <button class="md-icon-button" type="button" data-copy data-url="${esc(url)}" data-tip="Copy link" aria-label="Copy link">${icon("copy")}</button>`;
    const actBtn = (action: string, ic: string, label: string, cls = "", confirm = "", confirmLabel = "Delete", tip = label) => `
      <form method="post" action="${action}" hx-post="${action}" ${hxDetail}>
        <button class="md-icon-button ${cls}" type="submit" data-tip="${tip}" aria-label="${label}"${confirm ? ` data-confirm="${confirm}" data-confirm-label="${confirmLabel}"` : ""}>${icon(ic)}</button>
      </form>`;
    const clientLine = clientLink ? `
      <div class="share-line">
        <span class="share-label">Client link</span>
        <span class="share-url-wrap" data-tip="${esc(clientLink)}"><span class="share-url">${esc(clientLink)}</span></span>
        <span class="share-icons">
          ${copyBtn(clientLink)}
          ${actBtn(`/invoices/${inv.id}/public-token/regenerate`, "refresh", "Regenerate link (invalidates the old one)", "", "", "Delete", "Regenerate link")}
          ${actBtn(`/invoices/${inv.id}/public-token/revoke`, "delete", "Revoke link", "danger", "Revoke the client link? The current URL will stop working.", "Revoke")}
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
    /* #424: the paid label stays exactly where it always was — first in the
       detail actions row. Only its styling changes: plain muted text becomes
       an M3 chip (check icon + label). Nothing else in the header moves. */
    return `<div id="invoice-detail">
      <div class="page-head no-print">
        <div class="invoice-detail-head">
          <a class="md-text-button detail-back" href="/invoices">${icon("arrow_left")}Invoices</a>
        </div>
        <div class="row">
          ${inv.status === "paid" && inv.paid_at ? `<span class="md-chip">${icon("check")}Paid ${esc(shortYmd(inv.paid_at))}</span>` : ""}
          <a class="md-icon-button tip-right" href="/invoices/${inv.id}.pdf" download data-tip="Download PDF" aria-label="Download PDF">${icon("download")}</a>
          ${next ? `<form method="post" action="/invoices/${inv.id}/status" class="inline" hx-post="/invoices/${inv.id}/status" ${hxDetail}>
            <input type="hidden" name="status" value="${next}">
            <button class="md-icon-button tip-right" type="submit" data-tip="${nextLabel}" aria-label="${nextLabel}">${icon("check")}</button>
          </form>` : ""}
          ${inv.status === "draft" ? `<form method="post" action="/invoices/${inv.id}/delete" class="inline">
            <button class="md-icon-button danger tip-right" type="submit" data-tip="Delete draft" aria-label="Delete draft" data-confirm="Delete this draft invoice? Its entries become unbilled again.">${icon("delete")}</button>
          </form>` : ""}
        </div>
      </div>
      ${invoiceDoc(inv)}
      ${internalBlock}
      ${shareLines}
      </div>`;
  }

  /* #364: list-detail replaced the standalone detail page — the detail body
     now renders inside the detail pane (or as the fragment the pane swaps). */
  return {
    invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2,
    invoiceSheet, invoiceDoc, invoiceDetailBody, invoiceListOob,
    invoiceDocumentHtml, invoicePdfInput, /* #301 */
  };
}
