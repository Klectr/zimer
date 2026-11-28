import { esc } from "../lib/format";
import { icon } from "../lib/icons";

export interface EmptyStateOptions {
  icon?: string;
  image?: { src: string; width: number; height: number };
  title?: string;
  body?: string;
  action?: string;
}

export function emptyState(opts: EmptyStateOptions): string {
  const visual = opts.image
    ? `<img class="empty-mascot" src="${esc(opts.image.src)}" alt="" width="${opts.image.width}" height="${opts.image.height}">`
    : opts.icon
      ? `<div class="ui-empty-icon">${icon(opts.icon)}</div>`
      : "";
  const title = opts.title ? `<div class="ui-empty-title">${esc(opts.title)}</div>` : "";
  const body = opts.body ? `<div class="ui-empty-body">${esc(opts.body)}</div>` : "";
  const action = opts.action ? `<div class="ui-empty-action">${opts.action}</div>` : "";
  return `<div class="ui-empty">${visual}${title}${body}${action}</div>`;
}
