import { esc } from "../lib/format";
import { card } from "./card";

export interface SettingsSectionOptions {
  title: string;
  hint?: string;
  bodyHtml: string;
  actionsHtml?: string;
}

export function settingsSection(opts: SettingsSectionOptions): string {
  const hint = opts.hint ? `<p class="ui-section-hint">${esc(opts.hint)}</p>` : "";
  const actions = opts.actionsHtml ? `<div class="ui-section-actions">${opts.actionsHtml}</div>` : "";
  const inner =
    `<div class="ui-section-head"><h3 class="ui-section-title">${esc(opts.title)}</h3>${hint}</div>` +
    opts.bodyHtml +
    actions;
  return card({ content: inner });
}
