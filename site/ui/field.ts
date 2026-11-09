import { esc } from "../lib/format";

export type TextFieldType = "text" | "email" | "number" | "date" | "time" | "datetime-local" | "tel" | "url" | "password" | "search";

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
  list?: string;
  attrs?: string;
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
  const list = opts.list ? ` list="${esc(opts.list)}"` : "";
  const attrs = opts.attrs ? ` ${opts.attrs}` : "";
  const input = `<input class="ui-input" type="${esc(opts.type ?? "text")}" id="${esc(opts.id)}"${name}${value}${placeholder}${required}${autocomplete}${min}${max}${step}${inputmode}${list}${attrs}>`;
  const control = opts.prefix || opts.suffix
    ? `<div class="ui-input-wrap">${opts.prefix ? `<span class="ui-affix ui-affix-prefix">${esc(opts.prefix)}</span>` : ""}${input}${opts.suffix ? `<span class="ui-affix ui-affix-suffix">${esc(opts.suffix)}</span>` : ""}</div>`
    : input;
  return (
    `<div class="ui-field">` +
    `<label class="ui-field-label" for="${esc(opts.id)}">${esc(opts.label)}</label>` +
    `${control}</div>`
  );
}

export interface TextAreaFieldOptions {
  id: string;
  label: string;
  name?: string;
  value?: string;
  rows?: number;
  required?: boolean;
  placeholder?: string;
  attrs?: string;
}

export function textAreaField(opts: TextAreaFieldOptions): string {
  const name = opts.name ? ` name="${esc(opts.name)}"` : "";
  const required = opts.required ? " required" : "";
  const placeholder = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : "";
  const attrs = opts.attrs ? ` ${opts.attrs}` : "";
  return (
    `<div class="ui-field">` +
    `<label class="ui-field-label" for="${esc(opts.id)}">${esc(opts.label)}</label>` +
    `<textarea class="ui-input" id="${esc(opts.id)}"${name} rows="${opts.rows ?? 3}"${required}${placeholder}${attrs}>${esc(opts.value ?? "")}</textarea></div>`
  );
}

export interface SelectOption {
  value: string;
  label: string;
  desc?: string;
  data?: Record<string, string | number>;
}

export interface SelectFieldOptions {
  id: string;
  label: string;
  name?: string;
  options: SelectOption[];
  value?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}

export function selectField(opts: SelectFieldOptions): string {
  const name = opts.name ? ` name="${esc(opts.name)}"` : "";
  const required = opts.required ? " required" : "";
  const disabled = opts.disabled ? " disabled" : "";
  const options = opts.options
    .map((o) => {
      const data = o.data
        ? Object.entries(o.data).map(([k, v]) => ` data-${esc(k)}="${esc(String(v))}"`).join("")
        : "";
      return `<option value="${esc(o.value)}"${o.desc ? ` data-desc="${esc(o.desc)}"` : ""}${data}${o.value === opts.value ? " selected" : ""}>${esc(o.label)}</option>`;
    })
    .join("");
  return (
    `<div class="ui-field">` +
    `<label class="ui-field-label" for="${esc(opts.id)}">${esc(opts.label)}</label>` +
    `<select class="ui-input ui-select${opts.className ? ` ${esc(opts.className)}` : ""}" id="${esc(opts.id)}"${name}${required}${disabled}>${options}</select></div>`
  );
}
