import { esc } from "../lib/format";

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
