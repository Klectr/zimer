import { esc } from "../lib/format";

export interface StatBlockOptions {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}

export function statBlock(opts: StatBlockOptions): string {
  const sub = opts.sub ? `<div class="ui-stat-sub">${esc(opts.sub)}</div>` : "";
  const valueCls = opts.valueClass ? ` ${esc(opts.valueClass)}` : "";
  return (
    `<div><div class="ui-stat-label">${esc(opts.label)}</div>` +
    `<div class="ui-stat-value${valueCls}">${esc(opts.value)}</div>${sub}</div>`
  );
}

export interface StatStripItem {
  label: string;
  value: string;
  note?: string;
  meter?: number;
  action?: { label: string; href: string };
  valueClass?: string;
}

/** The timer home's dense status strip: label, value, and its context on
 *  one line, with a thin meter when the number has a target. One card
 *  instead of three oversized ones — the same numbers in a third of the
 *  height. */
export function statStrip(items: StatStripItem[]): string {
  const cells = items.map((it) => {
    const note = it.note ? `<span class="ui-stat-cell-note">${esc(it.note)}</span>` : "";
    const action = it.action
      ? `<a class="ui-stat-link" href="${esc(it.action.href)}">${esc(it.action.label)}</a>`
      : "";
    const pct = it.meter != null ? Math.max(0, Math.min(100, it.meter)) : null;
    const meter = pct != null
      ? `<div class="ui-stat-meter" role="progressbar" aria-label="${esc(it.label)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct}%"></span></div>`
      : "";
    const valueCls = it.valueClass ? ` ${esc(it.valueClass)}` : "";
    return (
      `<div class="ui-stat-cell">` +
      `<div class="ui-stat-cell-head"><span class="ui-stat-label">${esc(it.label)}</span>${action}</div>` +
      `<div class="ui-stat-cell-value${valueCls}">${esc(it.value)}${note}</div>` +
      `${meter}</div>`
    );
  }).join("");
  return `<div class="ui-stat-strip">${cells}</div>`;
}
