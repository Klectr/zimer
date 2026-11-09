import { esc } from "../lib/format";
import { icon, ICONS } from "../lib/icons";
import { logoLockup } from "./logo-lockup";

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

export interface NavItemsOptions {
  items: NavItem[];
  active: string;
}

export function navItemsHtml(opts: NavItemsOptions): string {
  return opts.items
    .map((item) => {
      const active = item.key === opts.active;
      return (
        `<a href="${esc(item.href)}" class="ui-navitem${active ? " is-active" : ""}"` +
        `${active ? ` aria-current="page"` : ""}>${icon(item.icon)}<span>${esc(item.label)}</span></a>`
      );
    })
    .join("");
}

export interface AppSidebarOptions {
  items: NavItem[];
  active: string;
  footer?: string;
}

export function appSidebar(opts: AppSidebarOptions): string {
  const links = navItemsHtml(opts);
  const footer = opts.footer ? `<div class="ui-side-foot">${opts.footer}</div>` : "";
  return `<aside class="ui-side">${logoLockup()}<nav aria-label="Primary">${links}</nav>${footer}</aside>`;
}
