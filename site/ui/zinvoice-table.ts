import { esc } from "../lib/format";
import { card } from "./card";
import { emptyState } from "./empty-state";
import { filterChips, type FilterChipItem } from "./filter-chips";
import { textField } from "./field";
import { statusChip, type ZinvoiceStatus } from "./status-chip";

/** The Zinvoices list (suite mock, #1203): one line per Zinvoice — Number,
 *  Client, Issued, Due, Status, Total — plus its filter/search bar.
 *  Presentational: the view formats dates and money and decides overdue. */

export interface ZinvoiceTableRow {
  number: string;
  href: string;
  /** Omit for "No client". */
  client?: string;
  status: ZinvoiceStatus;
  /** Formatted issue date; drafts aren't issued, so it reads as a dash. */
  issued?: string;
  /** Formatted due date (dash for drafts or when unset). */
  due?: string;
  /** Formatted paid date, shown under Due on paid rows. */
  paid?: string;
  /** Sent and past due. overdueDays adds the age ("Overdue 12d"). */
  overdue?: boolean;
  overdueDays?: number;
  /** Formatted total, tax included. */
  total: string;
}

function rowChip(r: ZinvoiceTableRow): string {
  if (r.overdue) return statusChip("sent", { overdue: true, suffix: r.overdueDays ? `${r.overdueDays}d` : undefined });
  if (r.status === "paid") return statusChip("paid", { icon: "check" });
  return statusChip(r.status === "sent" ? "sent" : "draft");
}

function dueCell(r: ZinvoiceTableRow): string {
  if (r.status === "draft" || !r.due) return "—";
  const main = `<span class="inv-cell-main">${esc(r.due)}</span>`;
  return r.status === "paid" && r.paid ? main + `<span class="inv-cell-sub">Paid ${esc(r.paid)}</span>` : main;
}

/** Just the <tr>s — the page refreshes #inv-list out of band with these. */
export function zinvoiceTableRows(rows: ZinvoiceTableRow[]): string {
  return rows.map((r) => {
    const issued = r.status !== "draft" && r.issued ? esc(r.issued) : "—";
    return `
      <tr>
        <td><a class="inv-num-link" href="${esc(r.href)}">${esc(r.number)}</a></td>
        <td>${r.client ? esc(r.client) : "<em>No client</em>"}</td>
        <td>${issued}</td>
        <td class="col-opt">${dueCell(r)}</td>
        <td>${rowChip(r)}</td>
        <td class="num inv-amt">${esc(r.total)}</td>
      </tr>`;
  }).join("");
}

export interface ZinvoiceTableOptions {
  rows: ZinvoiceTableRow[];
  /** Empty-state copy and optional action when rows is empty. */
  emptyBody?: string;
  emptyActionHtml?: string;
}

export function zinvoiceTable(o: ZinvoiceTableOptions): string {
  if (!o.rows.length) {
    return card({ content: emptyState({ icon: "receipt", body: o.emptyBody ?? "No Zinvoices yet.", action: o.emptyActionHtml }) });
  }
  return card({
    className: "inv-table-card",
    content: `<div class="table-wrap"><table class="ui-table">
        <thead><tr><th scope="col">Number</th><th scope="col">Client</th><th scope="col">Issued</th><th scope="col" class="col-opt">Due</th><th scope="col">Status</th><th scope="col" class="num">Total</th></tr></thead>
        <tbody id="inv-list">${zinvoiceTableRows(o.rows)}</tbody>
      </table></div>`,
  });
}

export interface ZinvoiceFilterBarOptions {
  chips: FilterChipItem[];
  active: string;
  /** Current search text. */
  q: string;
  /** Extra attributes on the search form (e.g. hx-get/hx-target). */
  searchAttrs?: string;
  /** Hidden inputs that ride along with a search (e.g. the active status). */
  hiddenHtml?: string;
}

export function zinvoiceFilterBar(o: ZinvoiceFilterBarOptions): string {
  return `<div class="inv-filter-row">
      ${filterChips({ items: o.chips, active: o.active, label: "Filter Zinvoices by status" })}
      <form method="get" action="/invoices" class="inv-search"${o.searchAttrs ? ` ${o.searchAttrs}` : ""}>
        ${o.hiddenHtml ?? ""}
        ${textField({ id: "inv-q", label: "Search Zinvoices", labelHidden: true, icon: "search", name: "q", type: "search", value: o.q, placeholder: "Search client or number" })}
      </form>
    </div>`;
}
