import { esc } from "../lib/format";
import { icon } from "../lib/icons";

export interface EmptyStateOptions {
  icon: string;
  title: string;
  body?: string;
  action?: string;
}

export function emptyState(opts: EmptyStateOptions): string {
  const body = opts.body ? `<div class="ui-empty-body">${esc(opts.body)}</div>` : "";
  const action = opts.action ? `<div class="ui-empty-action">${opts.action}</div>` : "";
  return (
    `<div class="ui-empty"><div class="ui-empty-icon">${icon(opts.icon)}</div>` +
    `<div class="ui-empty-title">${esc(opts.title)}</div>${body}${action}</div>`
  );
}
