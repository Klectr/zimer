import { esc } from "../lib/format";
import { card } from "./card";

export interface SettingsSectionOptions {
  title: string;
  hint?: string;
  bodyHtml: string;
  actionsHtml?: string;
  id?: string;
  level?: 2 | 3;
}

export function settingsSection(opts: SettingsSectionOptions): string {
  const hint = opts.hint ? `<p class="ui-section-hint">${esc(opts.hint)}</p>` : "";
  const actions = opts.actionsHtml ? `<div class="ui-section-actions">${opts.actionsHtml}</div>` : "";
  const tag = opts.level === 2 ? "h2" : "h3";
  const inner =
    `<div class="ui-section-head"><${tag} class="ui-section-title">${esc(opts.title)}</${tag}>${hint}</div>` +
    opts.bodyHtml +
    actions;
  return card({ content: inner, id: opts.id });
}
