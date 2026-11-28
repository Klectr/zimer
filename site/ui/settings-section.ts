import { esc } from "../lib/format";
import { card } from "./card";
import { icon } from "../lib/icons";

type IconName = Parameters<typeof icon>[0];

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

/** An export/download row: icon, title and description, one action. */
export interface SettingsDataRowOptions {
  icon: IconName;
  title: string;
  desc: string;
  actionHtml: string;
}

export function settingsDataRow(o: SettingsDataRowOptions): string {
  return `<div class="ui-data-row">${icon(o.icon)}<div class="ui-data-row-text"><div class="ui-data-row-title">${esc(o.title)}</div>` +
    `<div class="ui-data-row-desc">${esc(o.desc)}</div></div>${o.actionHtml}</div>`;
}

export const settingsDataList = (rows: string[]): string => `<div class="ui-data-list">${rows.join("")}</div>`;
