import { esc } from "../lib/format";
import { icon } from "../lib/icons";

export interface MenuItem {
  label: string;
  icon?: string;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuOptions {
  label: string;
  items: MenuItem[];
}

export function menu(opts: MenuOptions): string {
  const items = opts.items
    .map((item) => {
      const cls = "ui-menu-item" + (item.danger ? " is-danger" : "");
      const glyph = item.icon ? icon(item.icon) : "";
      if (item.disabled) {
        return `<span class="${cls}" role="menuitem" aria-disabled="true">${glyph}${esc(item.label)}</span>`;
      }
      if (item.href) {
        return `<a class="${cls}" role="menuitem" href="${esc(item.href)}">${glyph}${esc(item.label)}</a>`;
      }
      return `<button type="button" class="${cls}" role="menuitem">${glyph}${esc(item.label)}</button>`;
    })
    .join("");
  return `<div class="ui-menu" role="menu" aria-label="${esc(opts.label)}">${items}</div>`;
}
