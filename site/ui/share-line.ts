import { esc } from "../lib/format";

/** A labelled line with a value and actions — a link with copy / regenerate
 *  / revoke, a plain warning, or a wrapping note with an action. */
export interface ShareLineOptions {
  label: string;
  /** Warning tone for the label. */
  warn?: boolean;
  /** A URL, shown truncated with the full value in a tooltip. */
  url?: string;
  /** Plain text in place of a URL. */
  text?: string;
  /** A sentence that may wrap, with an action beside it. */
  note?: string;
  actionsHtml?: string;
}

export function shareLine(o: ShareLineOptions): string {
  const label = `<span class="share-label${o.warn ? " warn" : ""}">${esc(o.label)}</span>`;
  if (o.note != null) {
    return `<div class="share-line share-line-wrap">${label}<span class="share-note">${esc(o.note)}</span>${o.actionsHtml ?? ""}</div>`;
  }
  const value = o.url
    ? `<span class="share-url-wrap" data-tip="${esc(o.url)}"><span class="share-url">${esc(o.url)}</span></span>`
    : o.text ? `<span class="share-url">${esc(o.text)}</span>` : "";
  const actions = o.actionsHtml ? `<span class="share-icons">${o.actionsHtml}</span>` : "";
  return `<div class="share-line">${label}${value}${actions}</div>`;
}
