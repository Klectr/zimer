import { esc } from "../lib/format";
import { icon, ICONS } from "../lib/icons";

export interface IconButtonOptions {
  icon: keyof typeof ICONS;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  id?: string;
  attrs?: string;
}

export function iconButton(opts: IconButtonOptions): string {
  const cls = "ui-icon-btn" + (opts.danger ? " ui-icon-btn-danger" : "");
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  const disabled = opts.disabled ? " disabled" : "";
  const attrs = opts.attrs ? ` ${opts.attrs}` : "";
  return (
    `<button type="${esc(opts.type ?? "button")}" class="${cls}"${id}${disabled}${attrs} ` +
    `aria-label="${esc(opts.label)}" title="${esc(opts.label)}">${icon(opts.icon)}</button>`
  );
}
