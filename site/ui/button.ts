import { esc } from "../lib/format";

export type ButtonVariant = "primary" | "default" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  danger?: boolean;
  block?: boolean;
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

export interface LinkButtonOptions {
  label: string;
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  external?: boolean;
}

export function linkButton(opts: LinkButtonOptions): string {
  const variant = opts.variant ?? "default";
  let cls = VARIANT_CLASS[variant];
  if (opts.size === "sm") cls += " ui-btn-sm";
  if (opts.size === "lg") cls += " ui-btn-lg";
  if (opts.block) cls += " ui-btn-block";
  const ext = opts.external ? ` target="_blank" rel="noopener"` : "";
  return `<a class="${cls}" href="${esc(opts.href)}"${ext}>${esc(opts.label)}</a>`;
}

export function button(opts: ButtonOptions): string {
  const variant = opts.variant ?? "default";
  let cls = VARIANT_CLASS[variant];
  if (opts.size === "sm") cls += " ui-btn-sm";
  if (opts.size === "lg") cls += " ui-btn-lg";
  if (opts.danger) cls += " ui-btn-danger";
  if (opts.block) cls += " ui-btn-block";
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  const disabled = opts.disabled ? " disabled" : "";
  const attrs = opts.attrs ? ` ${opts.attrs}` : "";
  return `<button type="${esc(opts.type ?? "button")}" class="${cls}"${id}${disabled}${attrs}>${esc(opts.label)}</button>`;
}
