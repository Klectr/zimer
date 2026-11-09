import { esc } from "../lib/format";

export interface TabItem {
  key: string;
  href: string;
  label: string;
}

export interface TabsOptions {
  items: TabItem[];
  active: string;
  label: string;
}

export function tabs(opts: TabsOptions): string {
  const links = opts.items
    .map((item) => {
      const active = item.key === opts.active;
      return (
        `<a href="${esc(item.href)}" class="ui-tab${active ? " is-active" : ""}"` +
        `${active ? ` aria-current="page"` : ""}>${esc(item.label)}</a>`
      );
    })
    .join("");
  return `<nav class="ui-tabs" aria-label="${esc(opts.label)}">${links}</nav>`;
}
