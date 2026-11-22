/** Invoice views: list page, new-invoice wizard (step 1 + step-2 fragment),
 *  template picker + invoice sheet, detail body fragment, and detail page.
 *  invoiceSheet is also returned so the public-views factory can reuse it. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, daysBetween, durationSeconds, esc, fmtDur, money, round2, shortDateRange, shortDateRangeYear, shortYmd, clientTermsDescription, termsDays, termsDescription, termsKey, todayStr } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { getMeta } from "../db.ts";
import { workspaceEmpty } from "../lib/demo.ts"; /* #300: empty-state CTA */
import type { Invoice, InvoiceItem, NewInvParams } from "../lib/types.ts";
import type { PdfInvoice } from "../pdf.ts";
import { listProofs } from "../lib/payment_proofs.ts"; /* #956 */
import { button, linkButton } from "../ui/button.ts";
import { card } from "../ui/card.ts";
import { appHeader } from "../ui/app-header.ts";
import { iconButton } from "../ui/icon-button.ts";
import { emptyState } from "../ui/empty-state.ts";
import { statBlock } from "../ui/stat.ts";
import { statusChip, stripePaidChip } from "../ui/status-chip.ts";
import { zinvoiceTable, zinvoiceTableRows, type ZinvoiceTableRow } from "../ui/zinvoice-table.ts";
import { filterChips } from "../ui/filter-chips.ts";
import { textField } from "../ui/field.ts";
import { lineItemsHeadRow, wizardLayout, wizardLinesSection, wizardPreviewCard, wizardStep1, ZINVOICE_WIZARD_SCRIPT } from "./zinvoice-wizard.ts";
import { internalNotes, paymentProofSection, zinvoiceDetailHead, zinvoiceShareCard, zinvoiceStatusCard, ZINVOICE_COPY_SCRIPT } from "./zinvoice-detail.ts";
import { shareLine } from "../ui/share-line.ts";
import { timeBreakdownChart } from "../ui/time-breakdown.ts";
import { lineItemsTable } from "../ui/line-items.ts";
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
  const itemHead = lineItemsHeadRow;

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
      image: { src: "/static/mascot-empty.webp", width: 132, height: 132 },
      title: "No Zinvoices yet",
      body: "Turn tracked time into a Zinvoice — or explore first with fictional sample data.",
      action: demoCta || undefined,
    });
  }

  function rowTotal(r: any): number {
    return round2(r.subtotal * (1 + (r.tax_rate || 0) / 100));
  }

  /* The mock's summary figures. Outstanding means sent (incl.
     overdue) — drafts carry their own card, as in the mock. The
     revenue totals in site/lib/revenue.ts use the same definition
     (#1126). */
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

  /* #1222: the header sub must not repeat the stat cards below it —
     it carries the counts the cards don't say instead. */
  function statsSub(rows: any[]): string {
    const st = invoiceStats(rows);
    const parts = [`${rows.length} Zinvoice${rows.length === 1 ? "" : "s"}`];
    if (st.draftsCount) parts.push(`${st.draftsCount} draft${st.draftsCount === 1 ? "" : "s"}`);
    if (st.overdueCount) parts.push(`${st.overdueCount} overdue`);
    return parts.join(" · ");
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

  /* Status chips: the detail view's head still uses this one-chip form. */
  function invBadge(r: any): string {
    if (isOverdue(r)) return statusChip("sent", { overdue: true });
    if (r.status === "paid") return statusChip("paid", { icon: "check" });
    return statusChip(r.status === "sent" ? "sent" : "draft");
  }

  /* Map DB rows into the zinvoiceTable component (site/ui/zinvoice-table.ts):
     formatting and the overdue rule live here, the markup lives there. */
  function tableRow(r: any): ZinvoiceTableRow {
    const overdue = isOverdue(r);
    return {
      number: String(r.number),
      href: `/invoices?invoice=${r.id}`,
      client: r.client_name || undefined,
      status: r.status === "paid" ? "paid" : r.status === "sent" ? "sent" : "draft",
      issued: r.issue_date ? shortYmd(r.issue_date) : undefined,
      due: r.due_date ? shortYmd(r.due_date) : undefined,
      paid: r.paid_at ? shortYmd(r.paid_at) : undefined,
      overdue,
      overdueDays: overdue && r.due_date ? Math.max(0, daysBetween(r.due_date as string, todayStr())) : undefined,
      total: money(rowTotal(r)),
    };
  }

  function invoiceTableRowsHtml(rows: any[]): string {
    return zinvoiceTableRows(rows.map(tableRow));
  }

  function invoiceTableHtml(rows: any[], filtered: boolean): string {
    return zinvoiceTable({
      rows: rows.map(tableRow),
      emptyBody: filtered ? "No Zinvoices match this filter." : "No Zinvoices yet.",
      emptyActionHtml: filtered ? linkButton({ label: "Clear filter", href: "/invoices", variant: "ghost" }) : undefined,
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
    const chips = FILTERS.map(f => ({
      key: f.key, label: f.label, href: hrefFor(f.key),
      /* The chips swap the list region in place, so switching a status
         never reloads the page or re-runs the layout. */
      attrs: `hx-get="${esc(hrefFor(f.key))}" hx-target="#inv-list-region" hx-swap="innerHTML" hx-push-url="true"`,
    }));
    return `<div class="inv-filter-row">
      ${filterChips({ items: chips, active, label: "Filter Zinvoices by status" })}
      <form method="get" action="/invoices" class="inv-search"
        hx-get="/invoices" hx-target="#inv-list-region" hx-swap="innerHTML" hx-push-url="true">
        ${active !== "all" ? `<input type="hidden" name="status" value="${esc(active)}">` : ""}
        ${textField({ id: "inv-q", label: "Search Zinvoices", labelHidden: true, icon: "search", name: "q", type: "search", value: q, placeholder: "Search client or number" })}
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
        `<div data-enter="3">${invoiceDetailBody(selected, origin)}</div>`, "invoices");
    }
    const head = appHeader({
      title: "Zinvoices",
      sub: rows.length ? statsSub(rows) : undefined,
      subId: "inv-sub",
      actions:
        (rows.length ? linkButton({ label: "Export CSV", href: "/export/invoices.csv", variant: "ghost", icon: "download", download: true, ariaLabel: "Export CSV" }) : "") +
        linkButton({ label: "New Zinvoice", href: "/invoices/new", variant: "primary", icon: "add", ariaLabel: "New Zinvoice" }),
    });
    if (!rows.length) {
      return layout("Zinvoices", `${head}
        <div data-enter="3">${emptyInvoices()}</div>`, "invoices");
    }
    const active = FILTERS.some(f => f.key === filters.status) ? String(filters.status) : "all";
    const q = String(filters.q || "").trim();
    return layout("Zinvoices", `${head}
      <div data-enter="3">${invoiceListRegionHtml(rows, active, q)}</div>`, "invoices");
  }

  function invoiceListRegionHtml(rows: any[], active: string, q: string): string {
    const ql = q.toLowerCase();
    const shown = rows.filter(r =>
      (active === "all" || (active === "overdue" ? isOverdue(r) : r.status === active)) &&
      (!ql || String(r.client_name || "").toLowerCase().includes(ql) || String(r.number || "").toLowerCase().includes(ql)));
    return `<div id="inv-list-region">${statsRowHtml(rows)}${filterRowHtml(active, q)}${invoiceTableHtml(shown, active !== "all" || !!q)}</div>`;
  }

  /** The htmx response for a filter/search change: stats, active chips,
   *  search field, and the narrowed table, without the page shell. */
  function invoiceListRegion(filters: { status?: string; q?: string } = {}): string {
    const rows = qInvoices.all() as any[];
    const active = FILTERS.some(f => f.key === filters.status) ? String(filters.status) : "all";
    return invoiceListRegionHtml(rows, active, String(filters.q || "").trim());
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

  function fmtBillHours(h: number): string {
    return round2(Number(h) || 0).toFixed(2);
  }

  function fmtTrackedHours(h: number): string {
    return fmtDur(Math.round((Number(h) || 0) * 3600));
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
    return wizardPreviewCard({
      number: p.number,
      chipHtml: invBadge({ status: "draft" }),
      lines: preview ? preview.items.map(it => ({ label: `${it.description} — ${fmtBillHours(it.hours)} h`, amount: money(it.amount) })) : [],
      total: money(t.total),
      dueDate: p.due_date, issueDate: p.issue_date, taxRate: p.tax_rate,
      notes: p.notes, internalNotes: p.internal_notes,
      disabled: noItems,
    });
  }

  /** Step 1: pick client + date range. Step 2 (preview): editable line items. */
  function invoiceNewPage(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string }): string {
    const clients = db.query("SELECT id, name, rate, payment_terms FROM clients ORDER BY name").all() as any[];
    const selClient = clients.find(c => String(c.id) === p.client_id);
    const sub = selClient ? `${selClient.name} · unbilled through ${shortYmd(p.to)}` : undefined;
    const step1 = wizardStep1({
      clientOptions: clientPickerOptions(clients), clientId: p.client_id,
      from: p.from, to: p.to,
      rate: p.rate || (selClient ? String(selClient.rate || "") : ""),
    });

    return layout("New Zinvoice", `
      ${appHeader({ title: "New Zinvoice", sub: sub || "Pick a client and period", subId: "inv-new-sub", actions: linkButton({ label: "Cancel", href: "/invoices", variant: "ghost" }) })}
      ${wizardLayout({
        stepItems: STEP_ITEMS, current: preview ? 1 : 0,
        step1Html: step1,
        step2Html: preview ? invoiceStep2(p, preview, true) : emptyStep2(),
        previewHtml: previewCardHtml(p, preview),
      })}
      ${ZINVOICE_WIZARD_SCRIPT}`, "invoices");
  }

  /* #71: step-2 as a fragment — the preview action swaps #invoice-step2 in
     place and advances the steps indicator and the live preview card
     out-of-band. The rows are the mock's unbilled-time table: grouped,
     editable line items with an include checkbox per row (in the date
     cell, so the shared header row stays identical to the sheet's). */
  /** Before a client is picked there is no preview to swap in, but the
   *  left card should still read as the two-step mock: an empty unbilled
   *  table with the manual-line action, not a dead page with a button. */
  function emptyStep2(): string {
    return wizardLinesSection({});
  }

  function invoiceStep2(p: NewInvParams, preview?: { items: any[]; emptyMsg?: string; rounding?: number | null }, embedded = false): string {
    if (!preview) return "";
    const section = wizardLinesSection({
      emptyMsg: preview.emptyMsg,
      roundingMinutes: preview.rounding,
      lines: preview.items.map(it => ({
        description: it.description, hours: it.hours, rate: it.rate, amount: money(it.amount),
        dateFrom: it.date_from || "", dateTo: it.date_to || "",
        dateLabel: shortDateRange(it.date_from, it.date_to), entryIds: it.entry_ids,
      })),
    });
    if (embedded) return section;
    return `<div id="inv-steps" hx-swap-oob="true">${steps({ items: STEP_ITEMS, current: 1 })}</div>`
      + section
      + `<div id="inv-preview" hx-swap-oob="true">${previewCardHtml(p, preview)}</div>`;
  }

  /** #899: per-day tracked hours behind the invoice — the time-breakdown
      chart's data. Each entry rounds UP to 5 minutes like invoicing (#199).
      #1049: days accumulate the rounded seconds unrounded — rounding each
      day to 2dp first made the chart total disagree with the billed hours
      (1.33 + 1.33 = 2.66 shown for 2.67 billed); consumers round once, at
      display. Empty when no time entries are linked to the invoice. */
  function timeBreakdown(inv: { id: number }): { date: string; hours: number }[] {
    const rows = db.query(
      `SELECT substr(start_time, 1, 10) AS day, start_time, end_time
       FROM time_entries WHERE invoice_id = ? AND end_time IS NOT NULL`
    ).all(inv.id) as any[];
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const secs = Math.ceil(durationSeconds(String(r.start_time), String(r.end_time)) / 300) * 300;
      if (secs > 0) byDay.set(r.day, (byDay.get(r.day) ?? 0) + secs);
    }
    return [...byDay.entries()]
      .map(([date, secs]) => ({ date, hours: secs / 3600 }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** #1049: the one total every breakdown surface must agree on — the
      billed line items' hours (billing rounds per project group, so a
      per-day sum can still differ by 0.01h on multi-project invoices).
      Falls back to the tracked days when the invoice carries no items. */
  function breakdownTotal(inv: { items?: InvoiceItem[] }, days: { hours: number }[]): number {
    if (inv.items?.length) return round2(inv.items.reduce((a, it) => a + (Number(it.hours) || 0), 0));
    return round2(days.reduce((a, d) => a + d.hours, 0));
  }

  /** #899: hand-rolled SVG bar chart of tracked time per day (weekly
      buckets when the range is long, so bars stay readable). Mirrors the
      revenue chart's markup. */
  function breakdownChart(days: { date: string; hours: number }[], totalOverride?: number): string {
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
        wk.set(wk0, (wk.get(wk0) ?? 0) + d.hours);
      }
      buckets = [...wk.entries()].sort().map(([date, hours]) => ({ label: "Wk of " + shortYmd(date), hours }));
      per = "week";
    } else {
      buckets = days.map(d => ({ label: shortYmd(d.date), hours: d.hours }));
      per = "day";
    }
    const total = totalOverride ?? round2(buckets.reduce((a, b) => a + b.hours, 0));
    return timeBreakdownChart({
      per: per as "day" | "week",
      totalLabel: fmtTrackedHours(total),
      bars: buckets.map(b => ({ label: b.label, hours: b.hours, tip: `${b.label}: ${fmtTrackedHours(b.hours)} tracked` })),
    });
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
        <td class="num inv-hours${it.hours === 1 ? " inv-hours-1" : ""}">${fmtBillHours(it.hours)}</td>
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
    const paidChip = inv.paid_via_stripe ? stripePaidChip() : "";
    const period = billingPeriod(inv);
    /* #233/#239: single invoice design — dark band, badge, from/bill-to.
       Business profile comes from meta; empty profile hides the From block. */
    const bizName = getMeta(db, "business_name");
    const bizEmail = getMeta(db, "business_email");
    /* #289: the invoice client's own terms win; global business_payment_terms is fallback.
       #293: fixed list — print the canned description.
       #295: pay-when-paid has no fixed due date, so the due line is suppressed. */
    const termsKey_ = termsKey(inv.client_payment_terms, getMeta(db, "business_payment_terms"));
    const terms = clientTermsDescription(termsKey_);
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
          <div class="inv-modern-title">Invoice</div>
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
        ${(() => { const bd = timeBreakdown(inv); return bd.length ? breakdownChart(bd, breakdownTotal(inv, bd)) : ""; })()}
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
  /** #1350: the Zinvoice's billing period. The period stored from the
      wizard wins (it may start before the first worked day — Saturday vs
      Monday). Older Zinvoices have none: #243 derives it from the line-item
      dates. #582: year-aware ("Sep 1 – Sep 28, 2026"). */
  function billingPeriod(inv: Invoice & { items: InvoiceItem[] }): string {
    if (inv.period_from && inv.period_to) return shortDateRangeYear(inv.period_from, inv.period_to);
    const froms = inv.items.map(it => it.date_from).filter(Boolean).sort() as string[];
    const tos = inv.items.map(it => it.date_to || it.date_from).filter(Boolean).sort() as string[];
    return froms.length ? shortDateRangeYear(froms[0], tos[tos.length - 1]) : "";
  }

  function invoicePdfInput(inv: Invoice & { items: InvoiceItem[] }, origin: string): PdfInvoice {
    const t = invoiceTotals(inv.items, inv.tax_rate);
    /* #289/#293/#295: effective terms key drives the canned description
       and whether the PDF due line is shown. */
    const termsKey_ = termsKey(inv.client_payment_terms, getMeta(db, "business_payment_terms"));
    const bd = timeBreakdown(inv);
    return {
      number: inv.number,
      status: inv.status,
      clientName: inv.client_name || "",
      clientAddress: inv.client_address || undefined, /* #627 */
      clientEmail: inv.client_email || undefined, /* #627 */
      issueDate: inv.issue_date,
      dueDate: inv.due_date,
      /* #1350: print the stored period; legacy Zinvoices keep #624 (the
         per-line Date column states the dates). */
      period: inv.period_from && inv.period_to ? billingPeriod(inv) : undefined,
      items: inv.items.map(it => ({
        description: it.description, hours: it.hours, rate: it.rate, amount: it.amount,
        dateFrom: it.date_from ?? null, dateTo: it.date_to ?? null, /* #243 */
      })),
      subtotal: t.subtotal, tax: t.tax, taxRate: inv.tax_rate, total: t.total,
      notes: inv.notes,
      timeBreakdown: bd, /* #899: per-day tracked hours → PDF page-2 chart */
      timeBreakdownTotal: breakdownTotal(inv, bd), /* #1049: PDF total = billed hours */
      fromName: getMeta(db, "business_name") || undefined,
      fromEmail: getMeta(db, "business_email") || undefined,
      fromAddress: getMeta(db, "business_address") || undefined,
      /* #243: payment terms, and the pay-online link.
         #289: the invoice client's own terms win; global is fallback.
         #293: fixed list — print the canned description.
         #295: pay-when-paid has no fixed due date — suppress the PDF due line.
         #639: paid invoices have nothing left to pay — drop the link. */
      terms: clientTermsDescription(termsKey_),
      hideDue: termsKey_ === "pay_when_paid",
      payUrl: inv.public_token && inv.status !== "paid" ? `${origin}/i/${inv.public_token}` : undefined,
      payByCard: !!inv.stripe_payment_link,
      paymentInstructions: getMeta(db, "business_payment_instructions") || undefined,
    };
  }

  /* #956: proof-of-payment attachments — evidence backing paid status.
     App surface only (never on the public invoice page or print). Upload is
     optional; a nudge encourages attaching proof when a paid invoice has
     none. */
  function proofSection(inv: Invoice): string {
    if (inv.status !== "sent" && inv.status !== "paid") return "";
    const proofs = listProofs(db, inv.id);
    const fmtSize = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(0)} KB`;
    return paymentProofSection({
      invoiceId: inv.id,
      uploadAction: `/invoices/${inv.id}/payment-proof`,
      nudge: inv.status === "paid" && proofs.length === 0,
      proofs: proofs.map(p => ({
        filename: p.filename,
        href: `/invoices/${inv.id}/payment-proof/${p.id}`,
        meta: `${fmtSize(p.size)} · ${shortYmd(p.created_at.slice(0, 10))}`,
        deleteHtml: `<form method="post" action="/invoices/${inv.id}/payment-proof/${p.id}/delete" class="inline">
            ${iconButton({ icon: "delete", label: "Delete proof", danger: true, type: "submit", attrs: `data-confirm="Delete this proof of payment?" data-confirm-label="Delete proof"` })}
          </form>`,
      })),
    });
  }

  /* #71: detail body as a fragment — status/Stripe/link actions swap
     #invoice-detail in place instead of reloading the page. The layout
     follows the suite mock: title head, a lines-table card on the left,
     and a status card + public link card rail on the right. */
  function invoiceDetailBody(inv: Invoice & { items: InvoiceItem[] }, origin: string): string {
    const hxDetail = `hx-target="#invoice-detail" hx-swap="outerHTML"`;
    const next = inv.status === "draft" ? "sent" : inv.status === "sent" ? "paid" : null;
    const nextLabel = next === "sent" ? "Mark sent" : next === "paid" ? "Mark paid" : "";
    const nextBtnLabel = next === "sent" ? "Mark Zinvoice sent" : next === "paid" ? "Mark Zinvoice paid" : "";
    const nextConfirm = next === "sent"
      ? "Mark this Zinvoice as sent? Sent Zinvoices can't be edited."
      : next === "paid" ? "Mark this Zinvoice as paid?" : "";
    const t = invoiceTotals(inv.items, inv.tax_rate);
    const token = getPublicToken(inv.id);
    const clientLink = token ? `${origin}/i/${token}` : null;
    const od = isOverdue(inv) ? daysBetween(inv.due_date as string, todayStr()) : 0;
    const bd = timeBreakdown(inv);
    const trackedHours = breakdownTotal(inv, bd);
    /* #229: the copy handler (ZINVOICE_COPY_SCRIPT) is delegated and id-free
       so htmx swaps stay safe; it covers the head's Copy pay link button and
       the public link card's copy button. */
    const copyBtn = (url: string) => `
      ${iconButton({ icon: "copy", label: "Copy link", attrs: `data-copy data-url="${esc(url)}"` })}`;
    const actBtn = (action: string, ic: string, label: string, cls = "", confirm = "", confirmLabel = label, tip = label) => `
      <form method="post" action="${action}" hx-post="${action}" ${hxDetail}>
        ${iconButton({ icon: ic, label, tip, danger: cls === "ui-icon-btn-danger", type: "submit", attrs: confirm ? `data-confirm="${confirm}" data-confirm-label="${confirmLabel}"` : undefined })}
      </form>`;
    const clientLine = clientLink
      ? shareLine({
          label: "Client link", url: clientLink,
          actionsHtml: copyBtn(clientLink) +
            actBtn(`/invoices/${inv.id}/public-token/regenerate`, "refresh", "Regenerate link (invalidates the old one)", "", "Regenerate the client link? The old URL will stop working.", "Regenerate", "Regenerate link") +
            actBtn(`/invoices/${inv.id}/public-token/revoke`, "delete", "Revoke link", "ui-icon-btn-danger", "Revoke the client link? The current URL will stop working.", "Revoke"),
        })
      : shareLine({
          label: "Client link",
          actionsHtml: `<form method="post" action="/invoices/${inv.id}/public-token/regenerate" hx-post="/invoices/${inv.id}/public-token/regenerate" ${hxDetail}>
            ${button({ label: "Create client link", icon: "add", type: "submit" })}
          </form>`,
        });
    /* #231: the Stripe payment row is gone from our UI — the public invoice
       page is the payment surface (it already renders Pay when a link
       exists). The link is still auto-created server-side on send. If that
       fails we show a one-line warning with a retry, so a missing Pay button
       can never fail silently. */
    const stripeWarn = (inv.status === "sent" && stripeConfigured() && !inv.stripe_payment_link)
      ? shareLine({ label: "Payment link", warn: true, text: "Couldn't create it — the client won't see a Pay button", actionsHtml: actBtn(`/invoices/${inv.id}/stripe-link`, "refresh", "Retry payment link") })
      : "";
    const canPay = inv.status === "sent" && (!!inv.stripe_payment_link || !!(getMeta(db, "business_payment_instructions") || "").trim());
    /* #1224: a sent Zinvoice with no card link and no saved instructions
       leaves the client's page without any way to pay — say so here, to the
       user, never on the public page. */
    const noPayPathWarn = (inv.status === "sent" && !canPay && !stripeWarn)
      ? shareLine({ label: "How to pay", warn: true, note: "Your client won't see how to pay.", actionsHtml: linkButton({ label: "Add payment instructions", href: "/settings", size: "sm" }) })
      : "";
    const publicLinkCard = zinvoiceShareCard({ canPay, linesHtml: clientLine + stripeWarn + noPayPathWarn });
    /* The timeline carries only events the data records: creation
       (created_at) and payment (paid_at). There is no sent-at or
       viewed-at column, so the timeline never invents them. */
    const createdYmd = String(inv.created_at || "").slice(0, 10);
    const statusChipHtml = invBadge(inv);
    const stripeChip = inv.paid_via_stripe ? stripePaidChip() : "";
    const progress = inv.status === "draft" ? 0 : inv.status === "sent" ? 50 : 100;
    const dueInDays = inv.status === "sent" && inv.due_date ? daysBetween(todayStr(), inv.due_date) : null;
    const progressTone = od ? "error" : dueInDays !== null && dueInDays >= 0 && dueInDays <= 7 ? "warning" : "neutral";
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
    if (createdYmd) activity.push(`${shortYmd(createdYmd)} — Created${trackedHours > 0 ? ` from ${fmtTrackedHours(trackedHours)} of tracked time` : ""}`);
    const statusCard = zinvoiceStatusCard({ chipHtml: statusChipHtml, extraChipHtml: stripeChip, progress, tone: progressTone, line: statusLine, activity });
    const totals = [
      ...(inv.tax_rate ? [
        { label: "Subtotal", amount: money(t.subtotal) },
        { label: `Tax (${inv.tax_rate}%)`, amount: money(t.tax) },
      ] : []),
      { label: "Time breakdown total", amount: fmtTrackedHours(inv.items.reduce((a, it) => a + (Number(it.hours) || 0), 0)) },
      { label: inv.status === "sent" ? "Total due" : "Total", amount: money(t.total) },
    ];
    const linesCard = card({
      content: lineItemsTable({
        items: inv.items.map(it => ({
          dateRange: shortDateRange(it.date_from, it.date_to),
          description: it.description,
          hours: fmtBillHours(it.hours),
          rate: money(it.rate),
          amount: money(it.amount),
        })),
        totals,
      }) + (inv.notes ? `<p class="inv-notes">${esc(inv.notes)}</p>` : ""),
    });
    const internalBlock = inv.internal_notes ? internalNotes(inv.internal_notes) : "";
    /* #424: the paid label stays exactly where it always was — first in the
       detail actions row. Only its styling changes (now the ui paid chip:
       check icon + label). Nothing else in the header moves. */
    const termsLabel = PAYMENT_TERMS[termsKey(inv.client_payment_terms, termsKey(null, getMeta(db, "business_payment_terms")))].label;
    return `<div id="invoice-detail">
      ${zinvoiceDetailHead({
        backHref: "/invoices",
        title: `Zinvoice ${inv.number}${inv.client_name ? ` — ${inv.client_name}` : ""}`,
        sub: `Issued ${shortYmd(inv.issue_date)}${inv.due_date ? ` · Due ${shortYmd(inv.due_date)}` : ""} · ${termsLabel}`,
        actionsHtml: `
          ${inv.status === "paid" && inv.paid_at ? statusChip("paid", { icon: "check", suffix: shortYmd(inv.paid_at) }) : ""}
          ${clientLink ? iconButton({ icon: "copy", label: "Copy pay link", className: "tip-right", attrs: `data-copy data-url="${esc(clientLink)}"` }) : ""}
          <a class="ui-icon-btn tip-right" href="/invoices/${inv.id}.pdf" download data-tip="Download PDF" aria-label="Download PDF">${icon("download")}</a>
          ${next ? `<form method="post" action="/invoices/${inv.id}/status" class="inline" hx-post="/invoices/${inv.id}/status" ${hxDetail}>
            <input type="hidden" name="status" value="${next}">
            ${button({ label: nextBtnLabel, variant: "primary", icon: "check", type: "submit", attrs: `data-confirm="${nextConfirm}" data-confirm-label="${nextLabel}"` })}
          </form>` : ""}
          ${inv.status === "draft" ? `<form method="post" action="/invoices/${inv.id}/delete" class="inline">
            ${iconButton({ icon: "delete", label: "Delete draft", danger: true, className: "tip-right", type: "submit", attrs: `data-confirm="Delete this draft Zinvoice? Its entries become unbilled again." data-confirm-label="Delete draft"` })}
          </form>` : ""}`,
      })}
      <div class="inv-detail-grid">
        <div class="inv-detail-main">
          ${linesCard}
          ${bd.length ? breakdownChart(bd, trackedHours) : ""}
          ${internalBlock}
          ${proofSection(inv)}
        </div>
        <div class="inv-detail-rail">
          ${statusCard}
          ${publicLinkCard}
        </div>
      </div>
      ${ZINVOICE_COPY_SCRIPT}
      </div>`;
  }

  /* The detail body renders as the standalone detail view (invoicesPage
     with a selection) or as the fragment its own actions swap in place. */
  return {
    invoicesPage, defaultNewInvParams, invoiceNewPage, invoiceStep2,
    invoiceSheet, invoiceDoc, invoiceDetailBody, invoiceListOob, invoiceListRegion,
    invoiceDocumentHtml, invoicePdfInput, /* #301 */
  };
}
