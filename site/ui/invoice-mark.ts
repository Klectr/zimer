import { esc } from "../lib/format";

/** #330: a time entry's Zinvoice state (sent/paid, or in a draft), with a
 *  plain house tooltip. */
export function invoiceMark(o: { label: string; tip: string; cls?: string }): string {
  return `<span class="ui-inv-mark${o.cls ? ` ${o.cls}` : ""}" data-tip="${esc(o.tip)}">${esc(o.label)}</span>`;
}
