import { esc } from "../lib/format";
import type { Story } from "../../zandbox/story";
import { button } from "./button";

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

export const fieldStories: Story[] = [
  {
    id: "field-text",
    group: "Field",
    title: "Text fields",
    render: () =>
      `<div style="display:grid;gap:16px;max-width:420px">` +
      textField({ id: "f-client", label: "Client name", name: "name" }) +
      textField({ id: "f-email", label: "Email", name: "email", type: "email", value: "billing@northwind.example", autocomplete: "email" }) +
      textField({ id: "f-rate", label: "Hourly rate", name: "rate", type: "number", value: "85", required: true }) +
      `</div>`,
  },
  {
    id: "field-select",
    group: "Field",
    title: "Select field",
    render: () =>
      `<div style="display:grid;gap:16px;max-width:420px">` +
      selectField({
        id: "f-project",
        label: "Project",
        name: "project",
        value: "site",
        options: [
          { value: "", label: "No project" },
          { value: "site", label: "Website redesign" },
          { value: "support", label: "Support retainer" },
        ],
      }) +
      `</div>`,
  },
  {
    id: "field-in-form",
    group: "Field",
    title: "In a form (form sits at the top)",
    render: () =>
      `<form style="display:grid;gap:16px;max-width:420px">` +
      textField({ id: "f-new-client", label: "New client", name: "name", required: true }) +
      `<div>` + button({ label: "Add client", type: "submit" }) + `</div>` +
      `</form>`,
  },
];
