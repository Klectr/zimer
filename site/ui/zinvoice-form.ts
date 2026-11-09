import { esc } from "../lib/format";
import { checkboxField } from "./choice";
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

export interface UnbilledEntry {
  id: string;
  label: string;
  hours: string;
  amount: string;
  included: boolean;
}

export function unbilledTable(entries: UnbilledEntry[]): string {
  if (!entries.length) return `<p class="ui-empty-note">No unbilled time in this period.</p>`;
  const rows = entries
    .map(
      (e) =>
        `<tr><td>${checkboxField({ id: `ub-${e.id}`, name: "entry", value: e.id, label: e.label, checked: e.included, bare: true })}</td>` +
        `<td>${esc(e.label)}</td>` +
        `<td class="num">${esc(e.hours)}</td><td class="num">${esc(e.amount)}</td></tr>`,
    )
    .join("");
  return (
    `<table class="ui-table"><thead><tr><th scope="col"><span class="ui-sr-only">Include</span></th><th scope="col">Entry</th>` +
    `<th scope="col" class="num">Hours</th><th scope="col" class="num">Amount</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

export interface SummaryLine {
  label: string;
  amount: string;
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
  const lines = opts.lines
    .map((l) => `<div class="ui-summary-line"><span>${esc(l.label)}</span><span class="num">${esc(l.amount)}</span></div>`)
    .join("");
  const body = opts.bodyHtml ?? "";
  const inner =
    `<div class="ui-card-head"><span class="ui-section-title">${esc(opts.title)}</span><span class="ui-card-head-end">${chip}</span></div>` +
    `${lines}` +
    `<div class="ui-summary-total"><span>${esc(opts.totalLabel)}</span><span class="num">${esc(opts.total)}</span></div>` +
    `${body}`;
  return card({ content: inner });
}
