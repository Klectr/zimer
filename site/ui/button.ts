import { esc } from "../lib/format";

export type ButtonVariant = "primary" | "default" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  danger?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  id?: string;
  attrs?: string;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "ui-btn ui-btn-primary",
  default: "ui-btn",
  ghost: "ui-btn ui-btn-ghost",
};

export function button(opts: ButtonOptions): string {
  const variant = opts.variant ?? "default";
  let cls = VARIANT_CLASS[variant];
  if (opts.size === "sm") cls += " ui-btn-sm";
  if (opts.size === "lg") cls += " ui-btn-lg";
  if (opts.danger) cls += " ui-btn-danger";
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  const disabled = opts.disabled ? " disabled" : "";
  const attrs = opts.attrs ? ` ${opts.attrs}` : "";
  return `<button type="${esc(opts.type ?? "button")}" class="${cls}"${id}${disabled}${attrs}>${esc(opts.label)}</button>`;
}
