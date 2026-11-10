import { esc } from "../lib/format";

export interface FilterChipItem {
  key: string;
  label: string;
  href: string;
}

export interface FilterChipsOptions {
  items: FilterChipItem[];
  active: string;
  label: string;
}

export function filterChips(opts: FilterChipsOptions): string {
  const links = opts.items
    .map((item) => {
      const active = item.key === opts.active;
      return (
        `<a href="${esc(item.href)}" class="ui-filter-chip${active ? " is-active" : ""}"` +
        `${active ? ` aria-current="true"` : ""}>${esc(item.label)}</a>`
      );
    })
    .join("");
  return `<nav class="ui-filter-chips" aria-label="${esc(opts.label)}">${links}</nav>`;
}
