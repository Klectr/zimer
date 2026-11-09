import { esc } from "../lib/format";

export type TextFieldType = "text" | "email" | "number" | "date" | "time" | "tel" | "url" | "password" | "search";

export interface TextFieldOptions {
  id: string;
  label: string;
  name?: string;
  type?: TextFieldType;
  value?: string;
  required?: boolean;
  autocomplete?: string;
}

export function textField(opts: TextFieldOptions): string {
  const name = opts.name ? ` name="${esc(opts.name)}"` : "";
  const value = opts.value != null ? ` value="${esc(opts.value)}"` : "";
  const required = opts.required ? " required" : "";
  const autocomplete = opts.autocomplete ? ` autocomplete="${esc(opts.autocomplete)}"` : "";
  return (
    `<div class="md-text-field">` +
    `<input type="${esc(opts.type ?? "text")}" id="${esc(opts.id)}"${name}${value}${required}${autocomplete} placeholder=" ">` +
    `<label for="${esc(opts.id)}">${esc(opts.label)}</label></div>`
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
    `<div class="md-text-field filled">` +
    `<select id="${esc(opts.id)}"${name}${required} aria-label="${esc(opts.label)}">${options}</select>` +
    `<label for="${esc(opts.id)}">${esc(opts.label)}</label></div>`
  );
}
