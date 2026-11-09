import { esc } from "../lib/format";
import { icon, ICONS } from "../lib/icons";
import { tooltip } from "./tooltip";

export interface IconButtonOptions {
  icon: keyof typeof ICONS;
  label: string;
  tip?: string | null;
  className?: string;
  danger?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  id?: string;
  attrs?: string;
  tooltip?: boolean;
}

export function iconButton(opts: IconButtonOptions): string {
  const cls = "ui-icon-btn" + (opts.danger ? " ui-icon-btn-danger" : "") + (opts.className ? ` ${opts.className}` : "");
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  const disabled = opts.disabled ? " disabled" : "";
  const attrs = opts.attrs ? ` ${opts.attrs}` : "";
  if (opts.tooltip) {
    if (!opts.id) throw new Error("iconButton: tooltip requires an id");
    const tipId = `${opts.id}-tip`;
    const btn =
      `<button type="${esc(opts.type ?? "button")}" class="${cls}"${id}${disabled}${attrs} ` +
      `aria-label="${esc(opts.label)}" aria-describedby="${esc(tipId)}">${icon(opts.icon)}</button>`;
    return tooltip({ id: tipId, label: opts.label, contentHtml: btn });
  }
  const tip = opts.tip === null ? "" : ` data-tip="${esc(opts.tip ?? opts.label)}"`;
  return (
    `<button type="${esc(opts.type ?? "button")}" class="${cls}"${id}${disabled}${attrs} ` +
    `aria-label="${esc(opts.label)}"${tip}>${icon(opts.icon)}</button>`
  );
}
