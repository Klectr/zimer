import { esc } from "../lib/format";

/** The body of every dead-end page — 404, 500, unknown Zinvoice link, 429.
 *  Never carries error details (those go to the server log only). The page
 *  shell (app layout or the minimal public one) wraps it. */
export interface ErrorPageOptions {
  title: string;
  body: string;
  /** e.g. the logo, above the title on public pages. */
  markHtml?: string;
  /** Wayfinding buttons. */
  actionsHtml?: string;
}

export function errorPage(o: ErrorPageOptions): string {
  return `
      <div class="error-page">
        ${o.markHtml ? `<div class="error-mark">${o.markHtml}</div>` : ""}
        <h1 class="ui-page-title">${esc(o.title)}</h1>
        <p class="muted">${esc(o.body)}</p>
        ${o.actionsHtml ? `<div class="error-actions">${o.actionsHtml}</div>` : ""}
      </div>`;
}
