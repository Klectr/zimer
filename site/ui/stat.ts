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
