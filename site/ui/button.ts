import { esc } from "../lib/format";
import type { Story } from "./story";

export type ButtonVariant = "filled" | "tonal" | "text";

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  danger?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  id?: string;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  filled: "md-filled-button",
  tonal: "md-tonal-button",
  text: "md-text-button",
};

export function button(opts: ButtonOptions): string {
  const variant = opts.variant ?? "filled";
  if (opts.danger && variant !== "text") {
    throw new Error(`button: danger is only styled for the text variant (got ${variant})`);
  }
  const cls = VARIANT_CLASS[variant] + (opts.danger ? " danger" : "");
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  const disabled = opts.disabled ? " disabled" : "";
  return `<button type="${esc(opts.type ?? "button")}" class="${cls}"${id}${disabled}>${esc(opts.label)}</button>`;
}

export const buttonStories: Story[] = [
  {
    id: "button-variants",
    group: "Button",
    title: "Variants",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Send Zinvoice" }) +
      button({ label: "Save draft", variant: "tonal" }) +
      button({ label: "Cancel", variant: "text" }) +
      `</div>`,
  },
  {
    id: "button-danger",
    group: "Button",
    title: "Danger",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Delete client", variant: "text", danger: true }) +
      button({ label: "Delete entry", variant: "text", danger: true }) +
      `</div>`,
  },
  {
    id: "button-disabled",
    group: "Button",
    title: "Disabled",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Send Zinvoice", disabled: true }) +
      button({ label: "Save draft", variant: "tonal", disabled: true }) +
      button({ label: "Cancel", variant: "text", disabled: true }) +
      `</div>`,
  },
];
