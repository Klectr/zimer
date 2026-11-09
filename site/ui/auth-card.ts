import { esc } from "../lib/format";
import { logoLockup } from "./logo-lockup";
import { button } from "./button";

export interface AuthCardOptions {
  action: string;
  title: string;
  sub: string;
  fieldsHtml: string;
  submitLabel: string;
  footerHtml?: string;
  note?: string;
}

export function authCard(opts: AuthCardOptions): string {
  const footer = opts.footerHtml ? `<div class="ui-auth-foot">${opts.footerHtml}</div>` : "";
  const note = opts.note ? `<div class="ui-auth-note">${esc(opts.note)}</div>` : "";
  return (
    `<div class="ui-auth-card">${logoLockup()}` +
    `<h2 class="ui-auth-title">${esc(opts.title)}</h2>` +
    `<p class="ui-auth-sub">${esc(opts.sub)}</p>` +
    `<form method="post" action="${esc(opts.action)}"><div class="ui-auth-fields">${opts.fieldsHtml}</div>` +
    button({ label: opts.submitLabel, variant: "primary", size: "lg", block: true, type: "submit" }) +
    `</form>${footer}${note}</div>`
  );
}
