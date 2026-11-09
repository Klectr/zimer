import { esc } from "../lib/format";

export type TextFieldType = "text" | "email" | "number" | "date" | "time" | "tel" | "url" | "password" | "search";

export interface TextFieldOptions {
  id: string;
  label: string;
  name?: string;
  type?: TextFieldType;
  value?: string;
  placeholder?: string;
  required?: boolean;
  autocomplete?: string;
  prefix?: string;
  suffix?: string;
  min?: string;
  max?: string;
  step?: string;
  inputmode?: string;
}

export function textField(opts: TextFieldOptions): string {
  const name = opts.name ? ` name="${esc(opts.name)}"` : "";
  const value = opts.value != null ? ` value="${esc(opts.value)}"` : "";
  const placeholder = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : "";
  const required = opts.required ? " required" : "";
  const autocomplete = opts.autocomplete ? ` autocomplete="${esc(opts.autocomplete)}"` : "";
  const min = opts.min ? ` min="${esc(opts.min)}"` : "";
  const max = opts.max ? ` max="${esc(opts.max)}"` : "";
  const step = opts.step ? ` step="${esc(opts.step)}"` : "";
  const inputmode = opts.inputmode ? ` inputmode="${esc(opts.inputmode)}"` : "";
  const input = `<input class="ui-input" type="${esc(opts.type ?? "text")}" id="${esc(opts.id)}"${name}${value}${placeholder}${required}${autocomplete}${min}${max}${step}${inputmode}>`;
  const control = opts.prefix || opts.suffix
    ? `<div class="ui-input-wrap">${opts.prefix ? `<span class="ui-affix ui-affix-prefix">${esc(opts.prefix)}</span>` : ""}${input}${opts.suffix ? `<span class="ui-affix ui-affix-suffix">${esc(opts.suffix)}</span>` : ""}</div>`
    : input;
  return (
    `<div class="ui-field">` +
    `<label class="ui-field-label" for="${esc(opts.id)}">${esc(opts.label)}</label>` +
    `${control}</div>`
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldOptions {
  id: string;
  label: string;
  name?: string;
  options: SelectOption[];
  value?: string;
  required?: boolean;
}

export function selectField(opts: SelectFieldOptions): string {
  const name = opts.name ? ` name="${esc(opts.name)}"` : "";
  const required = opts.required ? " required" : "";
  const options = opts.options
    .map(
      (o) =>
        `<option value="${esc(o.value)}"${o.value === opts.value ? " selected" : ""}>${esc(o.label)}</option>`,
    )
    .join("");
  return (
    `<div class="ui-field">` +
    `<label class="ui-field-label" for="${esc(opts.id)}">${esc(opts.label)}</label>` +
    `<select class="ui-input ui-select" id="${esc(opts.id)}"${name}${required}>${options}</select></div>`
  );
}
