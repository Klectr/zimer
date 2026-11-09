import { esc } from "../lib/format";

export interface AppHeaderOptions {
  title: string;
  sub?: string;
  subId?: string;
  actions?: string;
}

export function appHeader(opts: AppHeaderOptions): string {
  const sub = opts.sub ? `<p class="ui-app-sub"${opts.subId ? ` id="${esc(opts.subId)}"` : ""}>${esc(opts.sub)}</p>` : "";
  const actions = opts.actions ? `<div class="ui-app-actions">${opts.actions}</div>` : "";
  return `<header class="ui-app-head"><div><h1 class="ui-app-title">${esc(opts.title)}</h1>${sub}</div>${actions}</header>`;
}
