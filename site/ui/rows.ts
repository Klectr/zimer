import { esc } from "../lib/format";
import { statusChip, type ZinvoiceStatus } from "./status-chip";

export interface ZinvoiceRowOptions {
  number: string;
  client: string;
  status: ZinvoiceStatus;
  overdueDays?: number;
  amount: string;
  meta: string;
  href: string;
}

export function zinvoiceRow(opts: ZinvoiceRowOptions): string {
  const overdue =
    opts.overdueDays != null
      ? `<span class="ui-chip ui-chip-overdue">${esc(String(opts.overdueDays))}d overdue</span>`
      : "";
  return (
    `<a href="${esc(opts.href)}" class="ui-row">` +
    `<div class="ui-row-main"><span class="ui-row-title">${esc(opts.number)}</span>` +
    `<div class="ui-row-meta">${esc(opts.client)}</div></div>` +
    statusChip(opts.status) +
    overdue +
    `<div class="ui-row-side"><span class="ui-row-amount">${esc(opts.amount)}</span>` +
    `<div class="ui-row-meta">${esc(opts.meta)}</div></div></a>`
  );
}

export interface EntryRowOptions {
  title: string;
  meta: string;
  duration: string;
  amount?: string;
  mark?: string;
  running?: boolean;
  actions?: string;
}

export function entryRow(opts: EntryRowOptions): string {
  const amount = opts.amount ? `<div class="ui-row-meta">${esc(opts.amount)}</div>` : "";
  const mark = opts.mark ? ` <span class="ui-row-meta">· ${esc(opts.mark)}</span>` : "";
  const live = opts.running ? ` data-live-duration` : "";
  const actions = opts.actions ? `<span>${opts.actions}</span>` : "";
  return (
    `<div class="ui-row${opts.running ? " is-running" : ""}">` +
    `<div class="ui-row-main"><span class="ui-row-title">${esc(opts.title)}</span>${mark}` +
    `<div class="ui-row-meta">${esc(opts.meta)}</div></div>` +
    `<div class="ui-row-side"><span class="ui-row-amount"${live}>${esc(opts.duration)}</span>${amount}</div>${actions}</div>`
  );
}

export interface ClientRowOptions {
  name: string;
  meta: string;
  actions?: string;
}

export function clientRow(opts: ClientRowOptions): string {
  const actions = opts.actions ? `<span>${opts.actions}</span>` : "";
  return (
    `<div class="ui-row"><div class="ui-row-main"><span class="ui-row-title">${esc(opts.name)}</span>` +
    `<div class="ui-row-meta">${esc(opts.meta)}</div></div>${actions}</div>`
  );
}
