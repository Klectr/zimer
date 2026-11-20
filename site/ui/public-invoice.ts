import { esc } from "../lib/format";
import { linkButton } from "./button";
import { summaryLines, type SummaryLine } from "./zinvoice-form";

export interface PublicParty {
  name?: string;
  email?: string;
  address?: string;
}

export interface PublicInvoiceOptions {
  business: string;
  meta: string;
  chipHtml?: string;
  from?: PublicParty;
  billTo?: PublicParty;
  lines: SummaryLine[];
  totalLabel: string;
  total: string;
  pay?: { label: string; href: string };
  download?: { label: string; href: string };
  note?: string;
  notes?: string;
  footer?: string;
}

function party(label: string, p?: PublicParty): string {
  const lines = [p?.address, p?.email]
    .flatMap((v) => (v || "").split("\n"))
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 6);
  const name = (p?.name || "").trim();
  if (!name && !lines.length) return "";
  const nameHtml = name ? `<div class="ui-public-party-name">${esc(name)}</div>` : "";
  const lineHtml = lines.map((l) => `<div class="ui-public-party-line">${esc(l)}</div>`).join("");
  return `<div class="ui-public-party"><div class="ui-public-party-label">${esc(label)}</div>${nameHtml}${lineHtml}</div>`;
}

export function publicInvoice(opts: PublicInvoiceOptions): string {
  const chip = opts.chipHtml ? `<span class="ui-card-head-end">${opts.chipHtml}</span>` : "";
  const lines = summaryLines(opts.lines, opts.totalLabel, opts.total);
  const parties = party("From", opts.from) + party("Bill to", opts.billTo);
  const partiesHtml = parties ? `<div class="ui-public-parties">${parties}</div>` : "";
  const pay = opts.pay ? linkButton({ label: opts.pay.label, href: opts.pay.href, variant: "primary", size: "lg", block: true, external: true }) : "";
  const download = opts.download ? linkButton({ label: opts.download.label, href: opts.download.href, variant: "default", size: "lg", block: true, download: true, icon: "download" }) : "";
  const note = opts.note ? `<p class="ui-public-note">${esc(opts.note)}</p>` : "";
  const notes = opts.notes ? `<p class="ui-public-notes">${esc(opts.notes)}</p>` : "";
  const footer = opts.footer ? `<p class="ui-public-footer">${esc(opts.footer)}</p>` : "";
  const sheet =
    `<div class="ui-public-sheet">` +
    `<div class="ui-card-head"><span><h1 class="ui-section-title">${esc(opts.business)}</h1>` +
    `<div class="ui-public-meta">${esc(opts.meta)}</div></span>${chip}</div>` +
    partiesHtml +
    `<div class="ui-public-lines">${lines}</div>` +
    notes +
    pay +
    download +
    `${note}</div>`;
  return `<div class="ui-public">${sheet}${footer}</div>`;
}
