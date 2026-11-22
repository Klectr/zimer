import { esc, safeCssColor } from "../lib/format";
import { icon } from "../lib/icons";

export interface EntryRowOptions {
  id?: string;
  attrs?: string;
  title: string;
  meta?: string;
  metaHtml?: string;
  duration: string;
  amount?: string;
  mark?: string;
  dot?: string;
  running?: boolean;
  actions?: string;
  href?: string;
  trailing?: string;
}

export function entryRow(opts: EntryRowOptions): string {
  const amount = opts.amount ? `<div class="ui-row-meta">${esc(opts.amount)}</div>` : "";
  const mark = opts.mark ? ` <span class="ui-row-meta">· ${esc(opts.mark)}</span>` : "";
  const live = opts.running ? ` data-live-duration` : "";
  const actions = opts.actions ? `<span class="ui-row-actions">${opts.actions}</span>` : "";
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  const attrs = opts.attrs ? ` ${opts.attrs}` : "";
  const safeDot = safeCssColor(opts.dot);
  const dot = safeDot ? `<span class="ui-row-dot" style="background:${esc(safeDot)}" aria-hidden="true"></span>` : "";
  const meta = opts.metaHtml ? `<div class="ui-row-meta">${opts.metaHtml}</div>` : `<div class="ui-row-meta">${esc(opts.meta ?? "")}</div>`;
  const cls = `ui-row${opts.running ? " is-running" : ""}`;
  const open = opts.href ? `<a class="${cls}"${id}${attrs} href="${esc(opts.href)}">` : `<div class="${cls}"${id}${attrs}>`;
  const close = opts.href ? `</a>` : `</div>`;
  return (
    open +
    `<div class="ui-row-main"><span class="ui-row-title">${dot}${esc(opts.title)}</span>${mark}` +
    `${meta}</div>` +
    `<div class="ui-row-side"><span class="ui-row-amount"${live}>${esc(opts.duration)}</span>${amount}</div>${actions}${opts.trailing ?? ""}${close}`
  );
}

export interface ClientRowOptions {
  name: string;
  meta?: string;
  actions?: string;
  href?: string;
  ariaLabel?: string;
  dot?: string;
  iconDot?: string;
  selected?: boolean;
  chevron?: boolean;
}

export function clientRow(opts: ClientRowOptions): string {
  const actions = opts.actions ? `<span class="ui-row-actions">${opts.actions}</span>` : "";
  const meta = opts.meta ? `<div class="ui-row-meta">${esc(opts.meta)}</div>` : "";
  const lead = opts.dot
    ? `<span class="ui-row-lead-dot" style="background:${esc(opts.dot)}" aria-hidden="true"></span>`
    : opts.iconDot
      ? `<span class="ui-row-lead-icon" aria-hidden="true">${icon(opts.iconDot)}</span>`
      : "";
  const chevron = opts.chevron ? `<span class="ui-row-chevron" aria-hidden="true">${icon("chevron_right")}</span>` : "";
  const main = `<div class="ui-row-main"><span class="ui-row-title">${esc(opts.name)}</span>${meta}</div>`;
  const cls = `ui-row${opts.selected ? " selected" : ""}`;
  const current = opts.selected ? ` aria-current="true"` : "";
  if (opts.href) {
    const label = opts.ariaLabel ? ` aria-label="${esc(opts.ariaLabel)}"` : "";
    return `<a class="${cls}" href="${esc(opts.href)}"${label}${current}>${lead}${main}${actions}${chevron}</a>`;
  }
  return `<div class="${cls}"${current}>${lead}${main}${actions}${chevron}</div>`;
}
