import { esc } from "../lib/format";
import { linkButton } from "./button";
import { summaryLines, type SummaryLine } from "./zinvoice-form";

export interface PublicInvoiceOptions {
  business: string;
  meta: string;
  chipHtml?: string;
  lines: SummaryLine[];
  totalLabel: string;
  total: string;
  pay?: { label: string; href: string };
  note?: string;
  notes?: string;
  footer?: string;
}

export function publicInvoice(opts: PublicInvoiceOptions): string {
  const chip = opts.chipHtml ? `<span class="ui-card-head-end">${opts.chipHtml}</span>` : "";
  const lines = summaryLines(opts.lines, opts.totalLabel, opts.total);
  const pay = opts.pay ? linkButton({ label: opts.pay.label, href: opts.pay.href, variant: "primary", size: "lg", block: true, external: true }) : "";
  const note = opts.note ? `<p class="ui-public-note">${esc(opts.note)}</p>` : "";
  const notes = opts.notes ? `<p class="ui-public-notes">${esc(opts.notes)}</p>` : "";
  const footer = opts.footer ? `<p class="ui-public-footer">${esc(opts.footer)}</p>` : "";
  const sheet =
    `<div class="ui-public-sheet">` +
    `<div class="ui-card-head"><span><h1 class="ui-section-title">${esc(opts.business)}</h1>` +
    `<div class="ui-public-meta">${esc(opts.meta)}</div></span>${chip}</div>` +
    `<div class="ui-public-lines">${lines}</div>` +
    notes +
    pay +
    `${note}</div>`;
  return `<div class="ui-public">${sheet}${footer}</div>`;
}
