import { logoLockup } from "./logo-lockup";

export interface ExtensionPopupOptions {
  statusHtml?: string;
  bodyHtml: string;
  footerHtml?: string;
}

export function extensionPopup(opts: ExtensionPopupOptions): string {
  const status = opts.statusHtml ? `<span class="ui-ext-status">${opts.statusHtml}</span>` : "";
  const footer = opts.footerHtml ? `<div class="ui-ext-footer">${opts.footerHtml}</div>` : "";
  return (
    `<div class="ui-ext">` +
    `<div class="ui-ext-head">${logoLockup()}${status}</div>` +
    `${opts.bodyHtml}${footer}</div>`
  );
}
