import { esc } from "../lib/format";

export interface CheckboxOptions {
  id: string;
  label: string;
  name?: string;
  value?: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  bare?: boolean;
}

export function checkboxField(opts: CheckboxOptions): string {
  const name = opts.name ? ` name="${esc(opts.name)}"` : "";
  const value = opts.value != null ? ` value="${esc(opts.value)}"` : "";
  const checked = opts.checked ? " checked" : "";
  const disabled = opts.disabled ? " disabled" : "";
  const aria = opts.bare ? ` aria-label="${esc(opts.label)}"` : "";
  const hint = opts.hint ? `<span class="ui-choice-hint">${esc(opts.hint)}</span>` : "";
  const text = opts.bare ? "" : `<span class="ui-choice-text"><span class="ui-choice-label">${esc(opts.label)}</span>${hint}</span>`;
  const dis = opts.disabled ? " is-disabled" : "";
  return (
    `<label class="ui-choice${dis}" for="${esc(opts.id)}">` +
    `<input class="ui-checkbox" type="checkbox" id="${esc(opts.id)}"${name}${value}${checked}${disabled}${aria}>` +
    `${text}</label>`
  );
}

export interface SwitchOptions {
  id: string;
  label: string;
  name?: string;
  value?: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  bare?: boolean;
}

export function switchField(opts: SwitchOptions): string {
  const name = opts.name ? ` name="${esc(opts.name)}"` : "";
  const value = opts.value != null ? ` value="${esc(opts.value)}"` : "";
  const checked = opts.checked ? " checked" : "";
  const disabled = opts.disabled ? " disabled" : "";
  const aria = opts.bare ? ` aria-label="${esc(opts.label)}"` : "";
  const hint = opts.hint ? `<span class="ui-choice-hint">${esc(opts.hint)}</span>` : "";
  const text = opts.bare ? "" : `<span class="ui-choice-text"><span class="ui-choice-label">${esc(opts.label)}</span>${hint}</span>`;
  const dis = opts.disabled ? " is-disabled" : "";
  return (
    `<label class="ui-choice${dis}" for="${esc(opts.id)}">` +
    `${text}` +
    `<input class="ui-switch" type="checkbox" role="switch" id="${esc(opts.id)}"${name}${value}${checked}${disabled}${aria}></label>`
  );
}

export interface SettingRowOptions {
  title: string;
  hint?: string;
  controlHtml: string;
}

export function settingRow(opts: SettingRowOptions): string {
  const hint = opts.hint ? `<div class="ui-setting-hint">${esc(opts.hint)}</div>` : "";
  return (
    `<div class="ui-setting-row"><div class="ui-setting-text">` +
    `<div class="ui-setting-title">${esc(opts.title)}</div>${hint}</div>` +
    `<div class="ui-setting-control">${opts.controlHtml}</div></div>`
  );
}
