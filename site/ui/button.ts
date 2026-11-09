import { esc } from "../lib/format";
import { icon, logo } from "../lib/icons";

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
  icon?: string;
  spinner?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "ui-btn ui-btn-primary",
  default: "ui-btn",
  ghost: "ui-btn ui-btn-ghost",
};

export interface LinkButtonOptions {
  label: string;
  href: string;
  icon?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  external?: boolean;
  id?: string;
  className?: string;
  download?: boolean;
  ariaLabel?: string;
}

export function linkButton(opts: LinkButtonOptions): string {
  const variant = opts.variant ?? "default";
  let cls = VARIANT_CLASS[variant];
  if (opts.size === "sm") cls += " ui-btn-sm";
  if (opts.size === "lg") cls += " ui-btn-lg";
  if (opts.block) cls += " ui-btn-block";
  if (opts.className) cls += ` ${opts.className}`;
  const ext = opts.external ? ` target="_blank" rel="noopener"` : "";
  const iconHtml = opts.icon ? icon(opts.icon) : "";
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  const dl = opts.download ? " download" : "";
  const aria = opts.ariaLabel ? ` aria-label="${esc(opts.ariaLabel)}"` : "";
  return `<a class="${cls}" href="${esc(opts.href)}"${id}${ext}${dl}${aria}>${iconHtml}${esc(opts.label)}</a>`;
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
  const iconHtml = opts.icon ? icon(opts.icon) : "";
  const spinnerHtml = opts.spinner ? `<span class="btn-spinner" aria-hidden="true">${logo(24, true)}</span>` : "";
  return `<button type="${esc(opts.type ?? "button")}" class="${cls}"${id}${disabled}${attrs}>${iconHtml}${spinnerHtml}${esc(opts.label)}</button>`;
}
