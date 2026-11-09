import { esc } from "../lib/format";

export interface LineItem {
  dateRange: string;
  description: string;
  hours: string;
  rate: string;
  amount: string;
}

export interface LineItemsTotal {
  label: string;
  amount: string;
}

export interface LineItemsTableOptions {
  items: LineItem[];
  totals: LineItemsTotal[];
}

export function lineItemsTable(opts: LineItemsTableOptions): string {
  const body =
    opts.items.length === 0
      ? `<tr><td colspan="5">No line items.</td></tr>`
      : opts.items
          .map(
            (item) =>
              `<tr><td>${esc(item.dateRange)}</td><td>${esc(item.description)}</td>` +
              `<td class="num">${esc(item.hours)}</td><td class="num">${esc(item.rate)}</td>` +
              `<td class="num">${esc(item.amount)}</td></tr>`,
          )
          .join("");
  const foot = opts.totals
    .map(
      (total) =>
        `<tr><td colspan="4">${esc(total.label)}</td><td class="num">${esc(total.amount)}</td></tr>`,
    )
    .join("");
  return (
    `<table class="ui-table"><thead><tr><th scope="col">Date</th><th scope="col">Description</th>` +
    `<th scope="col" class="num">Hours</th><th scope="col" class="num">Rate</th>` +
    `<th scope="col" class="num">Amount</th></tr></thead><tbody>${body}</tbody>` +
    `<tfoot>${foot}</tfoot></table>`
  );
}
