import { esc } from "../lib/format";
import { card } from "./card";

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
