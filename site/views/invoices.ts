/** Invoice views: list page, new-invoice wizard (step 1 + step-2 fragment),
 *  template picker + invoice sheet, detail body fragment, and detail page.
 *  invoiceSheet is also returned so the public-views factory can reuse it. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, daysBetween, durationSeconds, esc, fmtDur, money, round2, schemeColor, shortDateRange, shortDateRangeYear, shortYmd, termsDays, termsDescription, termsKey, todayStr } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { getMeta } from "../db.ts";
import { workspaceEmpty } from "../lib/demo.ts"; /* #300: empty-state CTA */
import type { Invoice, InvoiceItem, NewInvParams } from "../lib/types.ts";
import type { PdfInvoice } from "../pdf.ts";
import { listProofs } from "../lib/payment_proofs.ts"; /* #956 */
import { button, linkButton } from "../ui/button.ts";
import { card } from "../ui/card.ts";
import { selectField, textField } from "../ui/field.ts";
import { checkboxField } from "../ui/choice.ts";
import { clientRow } from "../ui/rows.ts";
import { appHeader } from "../ui/app-header.ts";
import { iconButton } from "../ui/icon-button.ts";
import { emptyState } from "../ui/empty-state.ts";
import { statBlock } from "../ui/stat.ts";
import { filterChips } from "../ui/filter-chips.ts";
import { lineItemsTable } from "../ui/line-items.ts";
import { progressBar } from "../ui/progress.ts";
import { formSection, invoiceSummary } from "../ui/zinvoice-form.ts";
import { steps } from "../ui/steps.ts";
import { PAYMENT_TERMS } from "../lib/format.ts";

export interface InvoiceViewDeps {
  db: Database;
  qInvoices: Statement;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  getPublicToken: (id: number) => string | null;
  stripeConfigured: () => boolean;
  nextInvoiceNumber: () => string;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  isOverdue: (row: { status: string; due_date?: string | null; client_payment_terms?: string | null }) => boolean;
  unbilledByClient: () => { id: number; name: string; secs: number }[];
}

export function createInvoiceViews(deps: InvoiceViewDeps) {
  const {
    db, qInvoices, layout,
    getPublicToken, stripeConfigured, nextInvoiceNumber, invoiceTotals, isOverdue,
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
     #586: the header already has the pumpkin New invoice button, so the empty
     state doesn't repeat it — no duplicate CTAs on one page. */
  function emptyInvoices(): string {
    const demoCta = workspaceEmpty(db) ? `
      <form method="post" action="/demo/load" class="inline">
        ${button({ label: "Load demo data", icon: "info", variant: "ghost", type: "submit" })}
      </form>` : "";
    return emptyState({
      image: { src: "/static/mascot-empty.png", width: 132, height: 132 },
      title: "No zinvoices yet",
      body: "Turn tracked time into a zinvoice — or explore first with fictional sample data.",
      action: demoCta || undefined,
    });
  }

  function rowTotal(r: any): number {
    return round2(r.subtotal * (1 + (r.tax_rate || 0) / 100));
  }

  /* The mock's summary figures. Outstanding here means sent
     (incl. overdue) — drafts carry their own card, as in the mock.
     This deliberately differs from the Timer revenue pane, whose
     Outstanding is invoiced-minus-paid over rows of every status
     (drafts included); the two definitions sharing one label is a
     recorded follow-up (#1126), not an accident of this change. */
  function invoiceStats(rows: any[]) {
    const sum = (xs: any[]) => round2(xs.reduce((a, r) => a + rowTotal(r), 0));
    const sent = rows.filter(r => r.status === "sent");
    const drafts = rows.filter(r => r.status === "draft");
    const month = todayStr().slice(0, 7);
    const paidMonth = rows.filter(r => r.status === "paid" && r.paid_at && String(r.paid_at).startsWith(month));
    const overdueCount = sent.filter(r => isOverdue(r)).length;
    const payDays = paidMonth
      .filter(r => r.paid_at && r.issue_date)
      .map(r => daysBetween(String(r.issue_date), String(r.paid_at).slice(0, 10)))
      .filter(d => d >= 0);
    const avgPayDays = payDays.length
      ? Math.round(payDays.reduce((a, d) => a + d, 0) / payDays.length)
      : null;
    return {
      outstanding: sum(sent), outstandingCount: sent.length, overdueCount,
      drafts: sum(drafts), draftsCount: drafts.length,
      paidMonth: sum(paidMonth), paidMonthCount: paidMonth.length, avgPayDays,
    };
  }

  function statsSub(rows: any[]): string {
    const st = invoiceStats(rows);
    return `Outstanding ${money(st.outstanding)} · Paid this month ${money(st.paidMonth)}`;
  }

  function statsRowHtml(rows: any[], oob = false): string {
    const st = invoiceStats(rows);
    const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${todayStr()}T12:00:00Z`));
    const outstandingSub = `${st.outstandingCount} open invoice${st.outstandingCount === 1 ? "" : "s"}`;
    const paidSub = st.paidMonthCount ? `${st.paidMonthCount} invoice${st.paidMonthCount === 1 ? "" : "s"} paid` : "No payments yet";
    return `<div class="ui-stat-row" id="inv-stats"${oob ? ' hx-swap-oob="true"' : ""}>` +
      card({ content: statBlock({ label: "Outstanding", value: money(st.outstanding), sub: outstandingSub }) }) +
      card({ content: statBlock({ label: "Drafts", value: String(st.draftsCount), sub: `${money(st.drafts)} not yet sent` }) }) +
      card({ content: statBlock({ label: `Paid · ${monthName}`, value: money(st.paidMonth), sub: paidSub }) }) +
      `</div>`;
  }

  function invBadge(r: any): string {
    if (isOverdue(r)) return `<span class="inv-badge inv-badge-overdue">Overdue</span>`;
    if (r.status === "paid") return `<span class="inv-badge inv-badge-paid">${icon("check")}Paid</span>`;
    if (r.status === "sent") return `<span class="inv-badge inv-badge-sent">Sent</span>`;
    return `<span class="inv-badge inv-badge-draft">Draft</span>`;
  }

  function statusCell(r: any): string {
    return invBadge(r);
  }

  function dueCell(r: any): string {
    if (r.status === "paid")
      return `<span class="inv-cell-main">${r.due_date ? esc(shortYmd(r.due_date)) : "—"}</span>` +
        (r.paid_at ? `<span class="inv-cell-sub">Paid ${esc(shortYmd(r.paid_at))}</span>` : "");
    if (r.status === "draft" || !r.due_date) return "—";
    const d = daysBetween(todayStr(), r.due_date as string);
    const sub = d < 0 ? `${-d}d ago` : d === 0 ? "Due today" : `in ${d}d`;
    return `<span class="inv-cell-main">${esc(shortYmd(r.due_date))}</span><span class="inv-cell-sub">${sub}</span>`;
  }

  function invoiceTableRowsHtml(rows: any[]): string {
    return rows.map(r => `
      <tr>
        <td><span class="inv-cell-main"><span class="inv-dot"${r.client_color ? ` style="background:${esc(schemeColor(r.client_color))}"` : ""}></span><span>${r.client_name ? esc(r.client_name) : "<em>No client</em>"}</span></span><span class="inv-cell-sub">${esc(r.number)}${r.project_name ? ` · ${esc(r.project_name)}` : ""}</span></td>
        <td><span class="inv-cell-main">${esc(r.number)}</span><span class="inv-cell-sub">${r.issue_date ? `Issued ${esc(shortYmd(r.issue_date))}` : "Not issued"}</span></td>
        <td>${statusCell(r)}</td>
        <td class="col-opt">${dueCell(r)}</td>
        <td class="num inv-amt">${money(rowTotal(r))}</td>
        <td class="inv-view-cell">${linkButton({ label: "View", href: `/invoices?invoice=${r.id}`, variant: "ghost", size: "sm" })}</td>
      </tr>`).join("");
  }

  function invoiceTableHtml(rows: any[], filtered: boolean): string {
    if (!rows.length) {
      return card({
        content: emptyState({
          icon: "receipt",
          body: filtered ? "No zinvoices match this filter." : "No zinvoices yet.",
          action: filtered ? linkButton({ label: "Clear filter", href: "/invoices", variant: "ghost" }) : undefined,
        }),
      });
    }
    return card({
      className: "inv-table-card",
      content: `<div class="table-wrap"><table class="ui-table">
        <thead><tr><th scope="col">Client</th><th scope="col">Invoice</th><th scope="col">Status</th><th scope="col" class="col-opt">Due</th><th scope="col" class="num">Amount</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody id="inv-list">${invoiceTableRowsHtml(rows)}</tbody>
      </table></div>`,
    });
  }

  const FILTERS = [
    { key: "all", label: "All" },
    { key: "draft", label: "Draft" },
    { key: "sent", label: "Sent" },
    { key: "paid", label: "Paid" },
    { key: "overdue", label: "Overdue" },
  ] as const;

  function filterRowHtml(active: string, q: string): string {
    const hrefFor = (key: string) => {
      const params = new URLSearchParams();
      if (key !== "all") params.set("status", key);
      if (q) params.set("q", q);
      const qs = params.toString();
      return qs ? `/invoices?${qs}` : "/invoices";
    };
    return `<div class="inv-filter-row">
      ${filterChips({ items: FILTERS.map(f => ({ key: f.key, label: f.label, href: hrefFor(f.key) })), active, label: "Filter zinvoices by status" })}
      <form method="get" action="/invoices" class="inv-search">
        ${active !== "all" ? `<input type="hidden" name="status" value="${esc(active)}">` : ""}
        ${textField({ id: "inv-q", label: "Search Zinvoices", name: "q", type: "search", value: q, placeholder: "Client or number" })}
      </form>
    </div>`;
  }

  /* Out-of-band refresh after a detail action changes an invoice — the
     stat cards and the header sub must not go stale. On the detail view
     none of these targets exist, so the swaps are no-ops there. */
  function invoiceListOob(selectedId: number): string {
    const rows = qInvoices.all() as any[];
    return `<tbody id="inv-list" hx-swap-oob="true">${invoiceTableRowsHtml(rows)}</tbody>`
      + statsRowHtml(rows, true)
      + `<p class="ui-app-sub" id="inv-sub" hx-swap-oob="true">${esc(statsSub(rows))}</p>`;
  }

  /* The list follows the suite mock: header, stat cards, filter chips +
     search, and a table card. A selected zinvoice renders as its own
     detail view (invoiceDetailBody) instead of a side pane. */
  function invoicesPage(selected: (Invoice & { items: InvoiceItem[] }) | null, origin: string, filters: { status?: string; q?: string } = {}): string {
    const rows = qInvoices.all() as any[];
    if (selected) {
      return layout(`Zinvoice ${selected.number}`,
        `<div class="scroll-region" data-enter="3">${invoiceDetailBody(selected, origin)}</div>`, "invoices", true);
    }
    const head = appHeader({
      title: "Zinvoices",
      sub: rows.length ? statsSub(rows) : undefined,
      subId: "inv-sub",
      actions:
        (rows.length ? linkButton({ label: "Export CSV", href: "/export/invoices.csv", variant: "ghost", icon: "download", download: true, ariaLabel: "Export CSV" }) : "") +
        linkButton({ label: "New Zinvoice", href: "/invoices/new", variant: "primary", icon: "add", ariaLabel: "New zinvoice" }),
    });
    if (!rows.length) {
      return layout("Zinvoices", `${head}
        <div class="scroll-region" data-enter="3">${emptyInvoices()}</div>`, "invoices", true);
    }
    const active = FILTERS.some(f => f.key === filters.status) ? String(filters.status) : "all";
    const q = String(filters.q || "").trim();
    const ql = q.toLowerCase();
    const shown = rows.filter(r =>
      (active === "all" || (active === "overdue" ? isOverdue(r) : r.status === active)) &&
      (!ql || String(r.client_name || "").toLowerCase().includes(ql) || String(r.number || "").toLowerCase().includes(ql)));
    return layout("Zinvoices", `${head}
      <div class="scroll-region" data-enter="3">
        ${statsRowHtml(rows)}
        ${filterRowHtml(active, q)}
        ${invoiceTableHtml(shown, active !== "all" || !!q)}
        ${widgetsHtml(rows)}
        ${unbilledSection(rows)}
      </div>`, "invoices", true);
  }

  function invWRow(main: string, side: string): string {
    return `<div class="inv-wrow"><span class="inv-wmain">${main}</span><span class="inv-wamt">${side}</span></div>`;
  }

  function widgetsHtml(rows: any[]): string {
    const sum = (xs: any[]) => round2(xs.reduce((a, r) => a + rowTotal(r), 0));
    const open = rows.filter(r => r.status === "sent");
    const paid = rows.filter(r => r.status === "paid");
    const name = (r: any) => r.client_name ? esc(r.client_name) : "<em>No client</em>";
    const unpaid = [...open].sort((a, b) =>
      (isOverdue(a) ? 0 : 1) - (isOverdue(b) ? 0 : 1) ||
      String(a.due_date || "").localeCompare(String(b.due_date || ""))).slice(0, 4);
    const unpaidCard = card({ content:
      `<div class="ui-card-head"><span class="ui-section-title">Unpaid invoices</span></div>` +
      `<p class="inv-wsub">Total outstanding ${money(sum(open))}</p>` +
      (unpaid.length ? unpaid.map(r => invWRow(
        `${invBadge(r)}<span class="inv-wtext"><span class="inv-wname">${name(r)}</span><span class="inv-cell-sub">${esc(r.number)}</span></span>`,
        `<span class="inv-wval">${money(rowTotal(r))}</span><span class="inv-cell-sub">${r.due_date ? esc(shortYmd(r.due_date)) : ""}</span>`)).join("")
        : `<p class="inv-wsub">Nothing outstanding.</p>`) });
    const byMap = new Map<string, number>();
    for (const r of open) byMap.set(r.client_name || "No client", (byMap.get(r.client_name || "No client") || 0) + rowTotal(r));
    const byClient = [...byMap.entries()].map(([n, v]) => ({ n, v: round2(v) })).sort((a, b) => b.v - a.v).slice(0, 4);
    const maxV = byClient.length ? byClient[0].v : 0;
    const byClientCard = card({ content:
      `<div class="ui-card-head"><span class="ui-section-title">Unpaid by client</span></div>` +
      (byClient.length ? byClient.map(c =>
        `<div class="inv-wrow"><span class="inv-wname">${esc(c.n)}</span><span class="inv-wval">${money(c.v)}</span></div><div class="inv-bar"><i style="width:${maxV ? Math.round((c.v / maxV) * 100) : 0}%"></i></div>`).join("")
        : `<p class="inv-wsub">Nothing outstanding.</p>`) });
    const recent = [...paid].filter(r => r.paid_at)
      .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at))).slice(0, 4);
    const recentCard = card({ content:
      `<div class="ui-card-head"><span class="ui-section-title">Recent payments</span></div>` +
      (recent.length ? recent.map(r => invWRow(
        `${invBadge(r)}<span class="inv-wtext"><span class="inv-wname">${name(r)}</span><span class="inv-cell-sub">${esc(r.number)}</span></span>`,
        `<span class="inv-wval">${money(rowTotal(r))}</span><span class="inv-cell-sub">${esc(shortYmd(r.paid_at))}</span>`)).join("")
        : `<p class="inv-wsub">No payments yet.</p>`) });
    const overdueN = open.filter(r => isOverdue(r)).length;
    const sumRow = (label: string, val: string, cls = "") =>
      `<div class="inv-wrow"><span class="inv-wname ${cls}">${label}</span><span class="inv-wval ${cls}">${val}</span></div>`;
    const summaryCard = card({ content:
      `<div class="ui-card-head"><span class="ui-section-title">All invoices</span><span class="ui-card-head-end"><span class="ui-stat-value">${rows.length}</span></span></div>` +
      sumRow("Open", money(sum(open))) +
      sumRow("Drafts", money(sum(rows.filter(r => r.status === "draft")))) +
      sumRow("Paid (all time)", money(sum(paid))) +
      sumRow("Overdue", String(overdueN), overdueN ? "inv-overdue-text" : "") });
    return `<div class="inv-widgets"><div class="inv-widgets-col">${unpaidCard}${byClientCard}</div>${recentCard}${summaryCard}</div>`;
  }

  /** #328: per-client finished, unbilled time with an "Invoice" shortcut into
      the "invoice the rest" prefill. Hidden when nothing is unbilled, and when
      the workspace has no invoices yet (the empty state owns that case). */
  function unbilledSection(rows: any[]): string {
    if (!rows.length) return "";
    const unbilled = unbilledByClient();
    if (!unbilled.length) return "";
    return `<h3 class="ui-block-title unbilled-head">Unbilled time</h3>
      <div class="ui-list">${unbilled.map(u => clientRow({
        name: u.name,
        meta: `${fmtDur(u.secs)} unbilled`,
        actions: linkButton({ label: "Zinvoice", href: `/invoices/new?client_id=${u.id}`, variant: "ghost", size: "sm" }),
      })).join("")}</div>`;
  }

  /* Milestone 20: NewInvParams type lives in lib/types.ts. */

  function defaultNewInvParams(): NewInvParams {
    const t = todayStr();
    /* #829: the prefilled due date follows the global payment terms (Net 30
       by default) — the hardcoded +15d contradicted the "due within N days"
       terms text the zinvoices print. Mirrors the data-terms-days derivation
       the client picker uses; due-on-receipt yields the issue date itself. */
    const days = termsDays(termsKey(null, getMeta(db, "business_payment_terms"))) ?? 30;
    return {
      client_id: "", from: addDays(t, -13), to: addDays(t, 1),
      rate: "", number: nextInvoiceNumber(), issue_date: t,
      due_date: addDays(t, days), tax_rate: "0", notes: "", internal_notes: "",
    };
  }

  /* #1121: the mock's wizard step labels. */
  const STEP_ITEMS = ["Client & period", "Pick time", "Review & send"];

  /* #1121: the client picker's options as data — the rate and effective
     terms days ride as data attributes, which the step-1 script reads to
     prefill the rate and derive the due date (#293). This replaces the
     manage factory's clientOptions HTML the wizard used to inject. */
  function clientPickerOptions(clients: any[]) {
    const g = termsKey(null, getMeta(db, "business_payment_terms"));
    return [
      { value: "", label: "Choose a client…" },
      ...clients.map(c => {
        const days = termsDays(c.payment_terms || g);
        const data: Record<string, string | number> = { rate: c.rate || 0 };
        if (days !== null) data["terms-days"] = days;
        return { value: String(c.id), label: c.name as string, data };
      }),
    ];
  }

  function fmtHours(h: number): string {
    const v = round2(Number(h) || 0);
    return `${v}h`;
  }

  /* The mock's live preview card: the checked lines, the total, the due
     date, and the create actions (Save draft / Send Zinvoice). It renders
     on the page and again as the preview fragment's out-of-band swap, so
     its fields (due date, number, tax, notes) round-trip through the
     preview POST with the rest of the form. */
  function previewCardHtml(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string }): string {
    const t = preview ? invoiceTotals(preview.items, Number(p.tax_rate) || 0) : { subtotal: 0, tax: 0, total: 0 };
    /* Nothing to create yet — no preview, or a preview with zero line
       items — leaves both create actions disabled instead of submitting
       to the create route's plain-text 400. */
    const noItems = !preview || preview.items.length === 0;
    const lines = preview
      ? preview.items.map(it => ({ label: `${it.description} — ${fmtHours(it.hours)}`, amount: money(it.amount) }))
      : [];
    return invoiceSummary({
      title: `Live preview — ${p.number}`,
      chipHtml: invBadge({ status: "draft" }),
      lines,
      totalLabel: "Total due",
      total: money(t.total),
      bodyHtml: `
        ${textField({ id: "inv-due", label: "Due date", name: "due_date", type: "date", value: p.due_date })}
        <details class="inv-more">
          <summary>More details</summary>
          ${textField({ id: "inv-number", label: "Zinvoice number", name: "number", value: p.number, required: true })}
          ${textField({ id: "inv-issue", label: "Issue date", name: "issue_date", type: "date", value: p.issue_date, required: true })}
          ${textField({ id: "inv-tax", label: "Tax", name: "tax_rate", type: "number", value: p.tax_rate, min: "0", step: "0.01", suffix: "%" })}
          ${textField({ id: "inv-notes", label: "Notes (optional)", name: "notes", value: p.notes })}
          ${textField({ id: "inv-internal", label: "Internal notes (only you see this)", name: "internal_notes", value: p.internal_notes })}
        </details>
        <div class="inv-summary-actions">
          ${button({ label: "Save draft", type: "submit", variant: "primary", block: true, disabled: noItems })}
          ${button({ label: "Send Zinvoice", type: "submit", block: true, disabled: noItems, attrs: 'name="intent" value="send"' })}
        </div>
        <p class="inv-send-note">Sending creates the public pay link.</p>`,
    });
  }

  /** Step 1: pick client + date range. Step 2 (preview): editable line items. */
  function invoiceNewPage(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string }): string {
    const clients = db.query("SELECT id, name, rate, payment_terms FROM clients ORDER BY name").all() as any[];
    const selClient = clients.find(c => String(c.id) === p.client_id);
    const sub = selClient ? `${selClient.name} · unbilled through ${shortYmd(p.to)}` : undefined;
    const step1 = formSection({ step: 1, title: "Client & period", bodyHtml: `
        <div class="form-info">
          ${icon("info")}
          <p>Only finished, unbilled entries on this client's projects are included. Client hourly rates can be set on the <a href="/manage">Clients page</a>.</p>
        </div>
        ${selectField({ id: "inv-client", label: "Client", name: "client_id", required: true, value: p.client_id, options: clientPickerOptions(clients) })}
        <div class="two-field" id="inv-range">
          ${textField({ id: "inv-from", label: "From", name: "from", type: "date", value: p.from, required: true })}
          ${textField({ id: "inv-to", label: "To", name: "to", type: "date", value: p.to, required: true })}
        </div>
        ${textField({ id: "inv-rate", label: "Hourly rate", name: "rate", type: "number", value: p.rate || (selClient ? String(selClient.rate || "") : ""), min: "0", step: "0.01", prefix: "$", suffix: "/hr" })}
        ${selClient ? `<p class="muted tiny">Rate from ${esc(selClient.name)}'s default — edit it to override for this zinvoice.</p>` : ""}
        <div class="row">${button({ label: "Preview line items", type: "submit", variant: "ghost", attrs: 'formaction="/invoices/preview" hx-post="/invoices/preview" hx-target="#invoice-step2" hx-swap="innerHTML" hx-include="#inv-create-form"' })}</div>` });



    return layout("New zinvoice", `
      ${appHeader({ title: "New Zinvoice", sub, subId: "inv-new-sub", actions: linkButton({ label: "Cancel", href: "/invoices", variant: "ghost" }) })}
      <div id="inv-steps">${steps({ items: STEP_ITEMS, current: preview ? 1 : 0 })}</div>
      <form method="post" action="/invoices" class="form" id="inv-create-form">
        <div class="inv-new-grid">
          <div>${card({ className: "form-card", content: `${step1}<div id="invoice-step2">${invoiceStep2(p, preview, true)}</div>` })}</div>
          <div id="inv-preview">${previewCardHtml(p, preview)}</div>
        </div>
      </form>
      <script>(function(){
        var sel=document.getElementById('inv-client'), rate=document.getElementById('inv-rate'),
            form=document.getElementById('inv-create-form'),
            rangeEl=document.getElementById('inv-range'), rangeTouched=false;
        var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        function addDaysStr(ymd,n){var p=ymd.split('-').map(Number);var d=new Date(p[0],p[1]-1,p[2]+n);
          return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
        function shortYmdStr(ymd){var p=String(ymd||'').split('-').map(Number);
          return p.length===3&&p[0] ? MONTHS[p[1]-1]+' '+p[2] : '';}
        function moneyFmt(n){return '$'+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
        function fmtH(h){var v=Math.round(h*100)/100;return (Number.isInteger(v)?String(v):String(v))+'h';}
        function dueEl(){return document.getElementById('inv-due');}
        function issueEl(){return document.getElementById('inv-issue');}
        /* The create actions mirror the step-2 rows: disabled while the
           table is empty (the server renders them that way for a zero-item
           preview), live once a row exists — a manual line added to an
           empty preview re-enables them without a round-trip. */
        function syncActions(){
          var wrap=document.getElementById('inv-preview');
          if(!wrap||!form) return;
          var has=form.querySelector('#invoice-step2 tbody tr')!==null;
          wrap.querySelectorAll('.inv-summary-actions button').forEach(function(b){ b.disabled=!has; });
        }
        /* #293: due date follows the selected client's terms (no HTMX
           round-trip — the days ride on data-terms-days). */
        function deriveDue(){
          var opt=sel.options[sel.selectedIndex], due=dueEl(), issue=issueEl();
          if(opt&&opt.dataset.termsDays&&issue&&issue.value&&due) due.value=addDaysStr(issue.value,parseInt(opt.dataset.termsDays,10));
        }
        function updateSub(){
          var sub=document.getElementById('inv-new-sub');
          if(!sub) return;
          var opt=sel.options[sel.selectedIndex];
          var to=document.getElementById('inv-to');
          sub.textContent=sel.value&&opt ? opt.text+' · unbilled through '+shortYmdStr(to?to.value:'') : '';
        }
        function loadPreview(){
          if(!window.htmx||!sel.value) return;
          window.htmx.ajax('POST','/invoices/preview',{source:'#inv-create-form',target:'#invoice-step2',swap:'innerHTML'});
        }
        /* The live preview card mirrors the checked rows: amounts and the
           total (with tax) recompute on every edit, no round-trip. */
        function recompute(){
          var wrap=document.getElementById('inv-preview');
          if(!wrap||!form) return;
          var taxEl=document.getElementById('inv-tax');
          var tax=taxEl?parseFloat(taxEl.value)||0:0;
          var lines=[], subtotal=0;
          form.querySelectorAll('#invoice-step2 tbody tr').forEach(function(tr){
            var inc=tr.querySelector('input[type="checkbox"]');
            var desc=tr.querySelector('input[name$="_desc"]');
            var hrs=tr.querySelector('input[name$="_hours"]');
            var rateEl=tr.querySelector('input[name$="_rate"]');
            if(!desc||!hrs||!rateEl) return;
            var h=parseFloat(hrs.value)||0, r=parseFloat(rateEl.value)||0;
            var amt=Math.round(h*r*100)/100;
            var amtEl=tr.querySelector('.inv-row-amount');
            if(amtEl) amtEl.textContent=moneyFmt(amt);
            if(inc&&!inc.checked) return;
            subtotal+=amt;
            if(h>0||desc.value) lines.push({label:(desc.value||'Item')+' — '+fmtH(h),amount:amt});
          });
          var total=Math.round(subtotal*(1+tax/100)*100)/100;
          var totalEl=wrap.querySelector('.ui-summary-total .num');
          wrap.querySelectorAll('.ui-summary-line').forEach(function(el){el.remove();});
          var totalRow=wrap.querySelector('.ui-summary-total');
          if(totalRow){
            lines.forEach(function(l){
              var div=document.createElement('div');
              div.className='ui-summary-line';
              var a=document.createElement('span'); a.textContent=l.label;
              var b=document.createElement('span'); b.className='num'; b.textContent=moneyFmt(l.amount);
              div.appendChild(a); div.appendChild(b);
              totalRow.parentNode.insertBefore(div,totalRow);
            });
          }
          if(totalEl) totalEl.textContent=moneyFmt(total);
          syncActions();
        }
        /* #328: "invoice the rest" — a hand-edited range is never clobbered.
           Delegated on the wrapper so it survives the HTMX range swap. */
        if(rangeEl) rangeEl.addEventListener('change',function(){rangeTouched=true; if(sel.value) loadPreview();});
        sel.addEventListener('change',function(){
          var opt=sel.options[sel.selectedIndex];
          if(opt&&opt.dataset.rate&&!rate.value) rate.value=opt.dataset.rate;
          deriveDue();
          updateSub();
          if(!window.htmx) return;
          if(sel.value&&!rangeTouched){
            window.htmx.ajax('GET','/partial/invoice-rest?client_id='+encodeURIComponent(sel.value),{target:'#inv-range',swap:'innerHTML'})
              .then(function(){ loadPreview(); });
          } else if(sel.value) loadPreview();
        });
        document.addEventListener('change',function(ev){
          var t=ev.target;
          if(t&&t.id==='inv-issue') deriveDue();
          /* Unchecking a row excludes it: its inputs leave the submission
             (the create handler skips groups with no hours) and the total. */
          if(t&&t.type==='checkbox'&&t.closest&&t.closest('#invoice-step2')){
            var tr=t.closest('tr');
            if(tr) tr.querySelectorAll('input').forEach(function(inp){ if(inp!==t) inp.disabled=!t.checked; });
            recompute();
          }
        });
        form.addEventListener('input',function(ev){
          var t=ev.target;
          if(!t||!t.closest) return;
          if(t.closest('#invoice-step2')||t.id==='inv-tax') recompute();
        });
        /* #668: manual line items — the Add button appends an editable row
           to the step-2 table and bumps the groups count the POST handler
           reads. Delegated on document so it survives the HTMX step-2 swap;
           inputs are looked up within the button's own form (never by id —
           #215), and hidden inputs stay inside the td (#536). */
        document.addEventListener('click',function(ev){
          var btn=ev.target.closest('[data-add-item]');
          if(!btn) return;
          var f=btn.closest('form');
          if(!f) return;
          var groups=f.querySelector('input[name="groups"]');
          var body=f.querySelector('#invoice-step2 tbody');
          if(!groups||!body) return;
          var i=parseInt(groups.value,10)||0;
          var tr=document.createElement('tr');
          tr.innerHTML=
            '<td><label class="ui-choice" for="inc-'+i+'"><input class="ui-checkbox" type="checkbox" id="inc-'+i+'" checked aria-label="Include line item"></label>'+
            '<input type="hidden" name="g'+i+'_date_from" value="">'+
            '<input type="hidden" name="g'+i+'_date_to" value=""></td>'+
            '<td><input type="text" name="g'+i+'_desc" class="cell-input" aria-label="Item description"></td>'+
            '<td><input type="number" name="g'+i+'_hours" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>'+
            '<td><input type="number" name="g'+i+'_rate" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>'+
            '<td class="num"><span class="inv-row-amount">$0.00</span>'+
            '<input type="hidden" name="g'+i+'_ids" value=""></td>';
          body.appendChild(tr);
          groups.value=String(i+1);
          syncActions();
          var desc=tr.querySelector('input[name="g'+i+'_desc"]');
          if(desc) desc.focus();
        });
      })();</script>`, "invoices");
  }

  /* #71: step-2 as a fragment — the preview action swaps #invoice-step2 in
     place and advances the steps indicator and the live preview card
     out-of-band. The rows are the mock's unbilled-time table: grouped,
     editable line items with an include checkbox per row (in the date
     cell, so the shared header row stays identical to the sheet's). */
  function invoiceStep2(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string; rounding?: number | null }, embedded = false): string {
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
          <td>${checkboxField({ id: `inc-${i}`, label: `Include ${it.description}`, bare: true, checked: true })}<span class="inv-cell-dates">${esc(shortDateRange(it.date_from, it.date_to))}</span><input type="hidden" name="g${i}_date_from" value="${esc(it.date_from || "")}"><input type="hidden" name="g${i}_date_to" value="${esc(it.date_to || "")}"></td>
          <td><input type="text" name="g${i}_desc" value="${esc(it.description)}" class="cell-input" aria-label="Item description"></td>
          <td><input type="number" name="g${i}_hours" value="${it.hours}" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>
          <td><input type="number" name="g${i}_rate" value="${it.rate}" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>
          <td class="num"><span class="inv-row-amount">${money(it.amount)}</span><input type="hidden" name="g${i}_ids" value="${it.entry_ids.join(",")}"></td>
        </tr>`).join("");
    const section = formSection({ step: 2, title: "Unbilled time — uncheck to exclude", bodyHtml: `
        ${emptyNote}
        ${roundingNote}
        <input type="hidden" name="groups" value="${preview.items.length}">
        <div class="table-wrap"><table class="ui-table">
          <thead>${itemHead()}</thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="row">${button({ label: "Add manual line", icon: "add", variant: "ghost", attrs: "data-add-item" })}</div>
        <p class="muted tiny">Amounts recalculate on save. Entries are marked billed when the zinvoice is created.</p>` });
    if (embedded) return section;
    return `<div id="inv-steps" hx-swap-oob="true">${steps({ items: STEP_ITEMS, current: 1 })}</div>`
      + section
      + `<div id="inv-preview" hx-swap-oob="true">${previewCardHtml(p, preview)}</div>`;
  }

  /** #899: per-day tracked hours behind the invoice — the time-breakdown
      chart's data. Each entry rounds UP to 5 minutes like invoicing (#199),
      so the chart totals agree with the tracked lines. Empty when no
      time entries are linked to the invoice. */
  function timeBreakdown(inv: { id: number }): { date: string; hours: number }[] {
    const rows = db.query(
      `SELECT substr(start_time, 1, 10) AS day, start_time, end_time
       FROM time_entries WHERE invoice_id = ? AND end_time IS NOT NULL`
    ).all(inv.id) as any[];
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const h = Math.ceil(durationSeconds(String(r.start_time), String(r.end_time)) / 300) * 300 / 3600;
      if (h > 0) byDay.set(r.day, round2((byDay.get(r.day) ?? 0) + h));
    }
    return [...byDay.entries()]
      .map(([date, hours]) => ({ date, hours }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** #899: hand-rolled SVG bar chart of tracked time per day (weekly
      buckets when the range is long, so bars stay readable). Mirrors the
      revenue chart's markup. */
  function breakdownChart(days: { date: string; hours: number }[]): string {
    type Bucket = { label: string; hours: number };
    let buckets: Bucket[], per: string;
    if (days.length > 40) {
      const wk = new Map<string, number>();
      const mondayOf = (ymd: string) => {
        const d = new Date(ymd + "T12:00:00");
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return d.toISOString().slice(0, 10);
      };
      for (const d of days) {
        const wk0 = mondayOf(d.date);
        wk.set(wk0, round2((wk.get(wk0) ?? 0) + d.hours));
      }
      buckets = [...wk.entries()].sort().map(([date, hours]) => ({ label: "Wk of " + shortYmd(date), hours }));
      per = "week";
    } else {
      buckets = days.map(d => ({ label: shortYmd(d.date), hours: d.hours }));
      per = "day";
    }
    const max = Math.max(1, ...buckets.map(b => b.hours));
    const W = 600, baseline = 150, areaH = 120, n = buckets.length;
    const slot = W / n, bw = Math.min(34, slot * 0.62);
    const bars = buckets.map((b, i) => {
      const h = Math.max(3, Math.round(b.hours / max * areaH));
      const x = (i * slot + (slot - bw) / 2).toFixed(1);
      const cx = (i * slot + slot / 2).toFixed(1);
      return `<g><title>${esc(`${b.label}: ${b.hours} hrs tracked`)}</title>` +
        `<rect x="${x}" y="${baseline - h}" width="${bw.toFixed(1)}" height="${h}" rx="4" class="tb-bar"/>` +
        `<text x="${cx}" y="${baseline + 18}" text-anchor="middle">${esc(b.label)}</text></g>`;
    }).join("");
    const total = round2(buckets.reduce((a, b) => a + b.hours, 0));
    return `<section class="inv-breakdown" aria-label="Time breakdown">` +
      `<div class="ui-block-title">Time breakdown</div>` +
      `<p class="muted inv-breakdown-sub">Tracked time per ${per} — ${total} hrs total</p>` +
      `<svg class="tb-chart" viewBox="0 0 ${W} 180" role="img" aria-label="Tracked time per ${per}">${bars}</svg>` +
      `</section>`;
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
    /* #831: the detail badge agrees with the list's status pill — a draft was
       never sent, so it reads "Draft" in the neutral tonal treatment instead
       of the amber "Unpaid" reserved for sent invoices awaiting payment. */
    const badgeCls = inv.status === "paid" ? " paid" : inv.status === "draft" ? " draft" : "";
    const badgeLabel = inv.status === "paid" ? "Paid" : inv.status === "draft" ? "Draft" : "Unpaid";
    const head = `
        <div class="inv-modern-band">
          <div class="inv-modern-title">Zinvoice</div>
          <div class="inv-modern-right">
            <div class="inv-modern-number">${esc(inv.number)}</div>
            <span class="inv-modern-badge${badgeCls}">${badgeLabel}</span>${paidChip}
          </div>
        </div>
        <div class="inv-modern-parties">
          <div><div class="inv-modern-label">Bill to</div><div><strong>${client}</strong></div>${billToLines}</div>
          ${bizName || bizEmail ? `<div class="inv-from"><div class="inv-modern-label">From</div>
            ${bizName ? `<div><strong>${esc(bizName)}</strong></div>` : ""}
            ${bizEmail ? `<div class="muted">${esc(bizEmail)}</div>` : ""}</div>` : ""}
        </div>
        ${datesLine}`;
    /* #859: only a sent zinvoice has something due — a draft was never sent,
       so the sheet's grand-total row reads "Total" like a paid one. */
    return `<div class="invoice-sheet template-modern" id="invoice-sheet">
        ${head}
        <div class="table-wrap"><table class="inv-table">
          <thead>${itemHead()}</thead>
          <tbody>${items || `<tr><td colspan="5" class="muted">No line items.</td></tr>`}</tbody>
          <tfoot>
            <tr><td colspan="4">Subtotal</td><td class="num">${money(t.subtotal)}</td></tr>
            ${inv.tax_rate ? `<tr><td colspan="4">Tax (${inv.tax_rate}%)</td><td class="num">${money(t.tax)}</td></tr>` : ""}
            <tr class="grand"><td colspan="4">${inv.status === "sent" ? "Total due" : "Total"}</td><td class="num">${money(t.total)}</td></tr>
          </tfoot>
        </table></div>
        ${/* #875: paid invoices have nothing due — drop the terms line, like
             the Total-not-Total-due row and the dropped pay-online link. */
          inv.status === "paid" ? "" : `<p class="inv-terms">${esc(terms)}</p>`}
        ${inv.notes ? `<p class="inv-notes">${esc(inv.notes)}</p>` : ""}
        ${(() => { const bd = timeBreakdown(inv); return bd.length ? breakdownChart(bd) : ""; })()}
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
      timeBreakdown: timeBreakdown(inv), /* #899: per-day tracked hours → PDF page-2 chart */
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

  /* #956: proof-of-payment attachments — evidence backing paid status.
     App surface only (never on the public invoice page or print). Upload is
     optional; a nudge encourages attaching proof when a paid invoice has
     none. */
  function paymentProofSection(inv: Invoice): string {
    if (inv.status !== "sent" && inv.status !== "paid") return "";
    const proofs = listProofs(db, inv.id);
    const fmtSize = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(0)} KB`;
    const rows = proofs.map(p => `
      <div class="proof-row">
        <a class="proof-name" href="/invoices/${inv.id}/payment-proof/${p.id}" target="_blank" rel="noopener">${esc(p.filename)}</a>
        <span class="proof-meta muted">${fmtSize(p.size)} · ${esc(shortYmd(p.created_at.slice(0, 10)))}</span>
        <span class="proof-icons">
          <a class="ui-icon-btn" href="/invoices/${inv.id}/payment-proof/${p.id}" download="${esc(p.filename)}" data-tip="Download" aria-label="Download proof">${icon("download")}</a>
          <form method="post" action="/invoices/${inv.id}/payment-proof/${p.id}/delete" class="inline">
            ${iconButton({ icon: "delete", label: "Delete proof", danger: true, type: "submit", attrs: `data-confirm="Delete this proof of payment?"` })}
          </form>
        </span>
      </div>`).join("");
    const nudge = inv.status === "paid" && proofs.length === 0 ? `
      <p class="proof-nudge muted">No proof attached — add the bank receipt or payment confirmation so this payment stays verifiable.</p>` : "";
    return `<section class="payment-proof no-print" id="proof" aria-label="Proof of payment">
      <div class="internal-notes-label">${icon("receipt")} Proof of payment</div>
      ${rows}
      ${nudge}
      <form method="post" action="/invoices/${inv.id}/payment-proof" enctype="multipart/form-data" class="proof-upload" data-invoice-id="${inv.id}">
        <label class="proof-file-label" for="proof-file-${inv.id}">Choose file</label>
        <input id="proof-file-${inv.id}" class="proof-file-input" type="file" name="proof" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" required>
      </form>
      <p class="proof-hint muted">PNG, JPEG, GIF, WebP or PDF, up to 10 MB. Optional — cash payments have no file.</p>
      <script>(function(){
        /* Upload proof without full page refresh. Guarded global so htmx
           re-renders of the detail pane don't stack listeners. */
        if (window.__proofPickerWired) return;
        window.__proofPickerWired = true;
        document.addEventListener("change", function(ev){
          var t = ev.target;
          if (!t || t.type !== "file" || !t.classList || !t.classList.contains("proof-file-input")) return;
          var form = t.closest("form");
          if (!t.files || !t.files[0] || !form) return;
          var fd = new FormData(form);
          fetch(form.action, { method: "POST", body: fd, headers: { "X-Proof-Upload": "1" } })
            .then(function(res){ if (!res.ok) throw new Error("upload failed"); return res.text(); })
            .then(function(){
              /* Re-fetch the invoice detail and swap just the proof section */
              var invId = form.getAttribute("data-invoice-id");
              return fetch("/invoices?invoice=" + invId, { headers: { "X-Proof-Refresh": "1" } });
            })
            .then(function(res){ return res.text(); })
            .then(function(pageHtml){
              var doc = new DOMParser().parseFromString(pageHtml, "text/html");
              var fresh = doc.getElementById("proof");
              var current = document.getElementById("proof");
              if (fresh && current) current.outerHTML = fresh.outerHTML;
            })
            .catch(function(){ form.submit(); });
        });
      })();</script>
    </section>`;
  }

  /* #71: detail body as a fragment — status/Stripe/link actions swap
     #invoice-detail in place instead of reloading the page. The layout
     follows the suite mock: title head, a lines-table card on the left,
     and a status card + public link card rail on the right. */
  function invoiceDetailBody(inv: Invoice & { items: InvoiceItem[] }, origin: string): string {
    const hxDetail = `hx-target="#invoice-detail" hx-swap="outerHTML"`;
    const next = inv.status === "draft" ? "sent" : inv.status === "sent" ? "paid" : null;
    const nextLabel = next === "sent" ? "Mark sent" : next === "paid" ? "Mark paid" : "";
    const nextConfirm = next === "sent"
      ? "Mark this zinvoice as sent? Sent zinvoices can't be edited."
      : next === "paid" ? "Mark this zinvoice as paid?" : "";
    const t = invoiceTotals(inv.items, inv.tax_rate);
    const token = getPublicToken(inv.id);
    const clientLink = token ? `${origin}/i/${token}` : null;
    const od = isOverdue(inv) ? daysBetween(inv.due_date as string, todayStr()) : 0;
    const bd = timeBreakdown(inv);
    const trackedHours = round2(bd.reduce((a, d) => a + d.hours, 0));
    /* #229: the copy handler is delegated and id-free so htmx swaps stay
       safe; it wires the whole detail root, which covers both the head's
       Copy pay link button and the public link card's copy button. */
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
      document.querySelectorAll(\"#invoice-detail\").forEach(wire);
    })();</script>`;
    const copyBtn = (url: string) => `
      ${iconButton({ icon: "copy", label: "Copy link", attrs: `data-copy data-url="${esc(url)}"` })}`;
    const actBtn = (action: string, ic: string, label: string, cls = "", confirm = "", confirmLabel = "Delete", tip = label) => `
      <form method="post" action="${action}" hx-post="${action}" ${hxDetail}>
        ${iconButton({ icon: ic, label, tip, danger: cls === "ui-icon-btn-danger", type: "submit", attrs: confirm ? `data-confirm="${confirm}" data-confirm-label="${confirmLabel}"` : undefined })}
      </form>`;
    const clientLine = clientLink ? `
      <div class="share-line">
        <span class="share-label">Client link</span>
        <span class="share-url-wrap" data-tip="${esc(clientLink)}"><span class="share-url">${esc(clientLink)}</span></span>
        <span class="share-icons">
          ${copyBtn(clientLink)}
          ${actBtn(`/invoices/${inv.id}/public-token/regenerate`, "refresh", "Regenerate link (invalidates the old one)", "", "Regenerate the client link? The old URL will stop working.", "Regenerate", "Regenerate link")}
          ${actBtn(`/invoices/${inv.id}/public-token/revoke`, "delete", "Revoke link", "ui-icon-btn-danger", "Revoke the client link? The current URL will stop working.", "Revoke")}
        </span>
      </div>` : `
      <div class="share-line">
        <span class="share-label">Client link</span>
        <span class="share-icons">
          <form method="post" action="/invoices/${inv.id}/public-token/regenerate" hx-post="/invoices/${inv.id}/public-token/regenerate" ${hxDetail}>
            ${button({ label: "Create client link", icon: "add", type: "submit" })}
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
    const publicLinkCard = `
      <section class="ui-card share-lines no-print" aria-label="Public link">
        <div class="ui-card-head"><span class="ui-section-title">Public link</span></div>
        <p class="muted">Anyone with the link can view and pay — no login for your client.</p>
        ${clientLine}
        ${stripeWarn}
      </section>`;
    /* The timeline carries only events the data records: creation
       (created_at) and payment (paid_at). There is no sent-at or
       viewed-at column, so the timeline never invents them. */
    const createdYmd = String(inv.created_at || "").slice(0, 10);
    const statusChipHtml = invBadge(inv);
    const stripeChip = inv.paid_via_stripe
      ? ` <span class="stripe-paid-chip">${icon("bolt")}<span>Paid via Stripe</span></span>` : "";
    const progress = inv.status === "draft" ? 0 : inv.status === "sent" ? 50 : 100;
    let statusLine: string;
    if (inv.status === "draft") statusLine = `${createdYmd ? `Created ${shortYmd(createdYmd)} · ` : ""}Not sent yet`;
    else if (inv.status === "paid") statusLine = inv.paid_at ? `Paid ${shortYmd(inv.paid_at)}` : "Paid";
    else if (od) statusLine = `Overdue ${od}d · Due ${shortYmd(inv.due_date as string)}`;
    else if (inv.due_date) {
      const d = daysBetween(todayStr(), inv.due_date);
      statusLine = `Due in ${d} day${d === 1 ? "" : "s"} · Due ${shortYmd(inv.due_date)}`;
    } else statusLine = "Sent · No due date";
    const activity: string[] = [];
    if (inv.paid_at) activity.push(`${shortYmd(inv.paid_at)} — Paid${inv.paid_via_stripe ? " via Stripe" : ""}`);
    if (createdYmd) activity.push(`${shortYmd(createdYmd)} — Created${trackedHours > 0 ? ` from ${fmtHours(trackedHours)} of tracked time` : ""}`);
    const statusCard = card({ className: "no-print", content: `
      <div class="ui-card-head"><span class="ui-section-title">Status</span><span class="ui-card-head-end">${statusChipHtml}${stripeChip}</span></div>
      ${progressBar({ value: progress, label: "Zinvoice progress" })}
      <p class="inv-status-line">${esc(statusLine)}</p>
      ${activity.length ? `<div class="inv-activity">${activity.map(a => `<div class="inv-activity-row">${esc(a)}</div>`).join("")}</div>` : ""}` });
    const totals = [
      ...(inv.tax_rate ? [
        { label: "Subtotal", amount: money(t.subtotal) },
        { label: `Tax (${inv.tax_rate}%)`, amount: money(t.tax) },
      ] : []),
      { label: "Time breakdown total", amount: fmtHours(round2(inv.items.reduce((a, it) => a + (Number(it.hours) || 0), 0))) },
      { label: inv.status === "sent" ? "Total due" : "Total", amount: money(t.total) },
    ];
    const linesCard = card({
      content: lineItemsTable({
        items: inv.items.map(it => ({
          dateRange: shortDateRange(it.date_from, it.date_to),
          description: it.description,
          hours: String(it.hours),
          rate: money(it.rate),
          amount: money(it.amount),
        })),
        totals,
      }) + (inv.notes ? `<p class="inv-notes">${esc(inv.notes)}</p>` : ""),
    });
    /* #302: internal-only notes — app surface only, never printed or shared. */
    const internalBlock = inv.internal_notes ? `
      <aside class="internal-notes no-print" aria-label="Internal notes">
        <div class="internal-notes-label">Internal notes</div>
        <p>${esc(inv.internal_notes)}</p>
      </aside>` : "";
    /* #424: the paid label stays exactly where it always was — first in the
       detail actions row. Only its styling changes (now the ui paid chip:
       check icon + label). Nothing else in the header moves. */
    const termsLabel = PAYMENT_TERMS[termsKey(inv.client_payment_terms, termsKey(null, getMeta(db, "business_payment_terms")))].label;
    return `<div id="invoice-detail">
      <div class="detail-title no-print">
        <h2 class="ui-section-title">Zinvoice ${esc(inv.number)}${inv.client_name ? ` — ${esc(inv.client_name)}` : ""}</h2>
        <p class="ui-app-sub">Issued ${esc(shortYmd(inv.issue_date))}${inv.due_date ? ` · Due ${esc(shortYmd(inv.due_date))}` : ""} · ${esc(termsLabel)}</p>
      </div>
      <div class="page-head no-print">
        <div class="invoice-detail-head">
          ${linkButton({ label: "Zinvoices", href: "/invoices", icon: "arrow_left", variant: "ghost", className: "detail-back" })}
        </div>
        <div class="row">
          ${inv.status === "paid" && inv.paid_at ? `<span class="inv-badge inv-badge-paid">${icon("check")}Paid ${esc(shortYmd(inv.paid_at))}</span>` : ""}
          ${clientLink ? iconButton({ icon: "copy", label: "Copy pay link", className: "tip-right", attrs: `data-copy data-url="${esc(clientLink)}"` }) : ""}
          <a class="ui-icon-btn tip-right" href="/invoices/${inv.id}.pdf" download data-tip="Download PDF" aria-label="Download PDF">${icon("download")}</a>
          ${next ? `<form method="post" action="/invoices/${inv.id}/status" class="inline" hx-post="/invoices/${inv.id}/status" ${hxDetail}>
            <input type="hidden" name="status" value="${next}">
            ${iconButton({ icon: "check", label: nextLabel, className: "tip-right", type: "submit", attrs: `data-confirm="${nextConfirm}" data-confirm-label="${nextLabel}"` })}
          </form>` : ""}
          ${inv.status === "draft" ? `<form method="post" action="/invoices/${inv.id}/delete" class="inline">
            ${iconButton({ icon: "delete", label: "Delete draft", danger: true, className: "tip-right", type: "submit", attrs: `data-confirm="Delete this draft zinvoice? Its entries become unbilled again."` })}
          </form>` : ""}
        </div>
      </div>
      <div class="inv-detail-grid">
        <div class="inv-detail-main">
          ${linesCard}
          ${bd.length ? breakdownChart(bd) : ""}
          ${internalBlock}
          ${paymentProofSection(inv)}
        </div>
        <div class="inv-detail-rail">
          ${statusCard}
          ${publicLinkCard}
        </div>
      </div>
      ${copyScript}
      </div>`;
  }

  /* The detail body renders as the standalone detail view (invoicesPage
     with a selection) or as the fragment its own actions swap in place. */
  return {
    invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2,
    invoiceSheet, invoiceDoc, invoiceDetailBody, invoiceListOob,
    invoiceDocumentHtml, invoicePdfInput, /* #301 */
  };
}
