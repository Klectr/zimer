import { esc } from "../lib/format";
import { card } from "./card";
import { checkboxField } from "./choice";

export interface FormSectionOptions {
  step: number;
  title: string;
  bodyHtml: string;
}

export function formSection(opts: FormSectionOptions): string {
  return (
    `<div class="ui-form-section">` +
    `<div class="ui-form-section-title">${opts.step} · ${esc(opts.title)}</div>` +
    `${opts.bodyHtml}</div>`
  );
}

export interface UnbilledRow {
  id: string;
  label: string;
  hours: string;
  amount: string;
  included: boolean;
}

export function unbilledTable(rows: UnbilledRow[]): string {
  const body =
    rows.length === 0
      ? `<tr><td colspan="4">No unbilled time.</td></tr>`
      : rows
          .map(
            (r) =>
              `<tr><td>${checkboxField({ id: `unbilled-${r.id}`, label: `Include ${r.label}`, bare: true, checked: r.included })}</td>` +
              `<td>${esc(r.label)}</td><td class="num">${esc(r.hours)}</td>` +
              `<td class="num">${esc(r.amount)}</td></tr>`,
          )
          .join("");
  return (
    `<table class="ui-table"><thead><tr><th scope="col"><span class="ui-sr-only">Include</span></th>` +
    `<th scope="col">Description</th><th scope="col" class="num">Hours</th>` +
    `<th scope="col" class="num">Amount</th></tr></thead><tbody>${body}</tbody></table>`
  );
}

export interface SummaryLine {
  label: string;
  amount: string;
  detail?: string;
}

export function summaryLines(lines: SummaryLine[], totalLabel: string, total: string): string {
  const rows = lines
    .map((l) => {
      const label = l.detail
        ? `<span class="ui-summary-label">${esc(l.label)}<span class="ui-summary-detail">${esc(l.detail)}</span></span>`
        : `<span>${esc(l.label)}</span>`;
      return `<div class="ui-summary-line">${label}<span class="num">${esc(l.amount)}</span></div>`;
    })
    .join("");
  return rows + `<div class="ui-summary-total"><span>${esc(totalLabel)}</span><span class="num">${esc(total)}</span></div>`;
}

export interface InvoiceSummaryOptions {
  title: string;
  chipHtml?: string;
  lines: SummaryLine[];
  totalLabel: string;
  total: string;
  bodyHtml?: string;
}

export function invoiceSummary(opts: InvoiceSummaryOptions): string {
  const chip = opts.chipHtml ?? "";
  const body = opts.bodyHtml ?? "";
  const inner =
    `<div class="ui-card-head"><span class="ui-section-title">${esc(opts.title)}</span><span class="ui-card-head-end">${chip}</span></div>` +
    summaryLines(opts.lines, opts.totalLabel, opts.total) +
    `${body}`;
  return card({ content: inner });
}
