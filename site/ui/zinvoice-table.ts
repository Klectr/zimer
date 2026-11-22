import { esc } from "../lib/format";
import { card } from "./card";
import { emptyState } from "./empty-state";
import { statusChip, type ZinvoiceStatus } from "./status-chip";
import { tooltip } from "./tooltip";

/** The Zinvoices list (suite mock, #1203): one line per Zinvoice — Number,
 *  Client, Status, Total. Dates live on the status chip: it says what's next
 *  (Due Dec 14 · Overdue 12d), its tooltip says when (Sent Nov 14).
 *  Presentational: the view formats dates and money and decides overdue. */

export interface ZinvoiceTableRow {
  number: string;
  href: string;
  /** Omit for "No client". */
  client?: string;
  status: ZinvoiceStatus;
  /** Sent and past due; overdueDays adds the age ("Overdue 12d"). */
  overdue?: boolean;
  overdueDays?: number;
  /** Short due date for a sent Zinvoice — the chip reads "Due Dec 14". */
  due?: string;
  /** When the status happened, for the chip's tooltip: "Sent Nov 14",
   *  "Paid Oct 31", "Created Nov 21". */
  history: string;
  /** Formatted total, tax included. */
  total: string;
}

/** The chip says what's next (Draft · Due Dec 14 · Overdue 12d · Paid);
 *  its tooltip says when the status happened. */
function rowChip(r: ZinvoiceTableRow): string {
  if (r.overdue) return statusChip("sent", { overdue: true, suffix: r.overdueDays ? `${r.overdueDays}d` : undefined });
  if (r.status === "paid") return statusChip("paid", { icon: "check" });
  if (r.status === "sent") return statusChip("sent", r.due ? { label: `Due ${r.due}` } : {});
  return statusChip("draft");
}

/** Chip + tooltip. The chip is focusable and described by the tooltip, so
 *  keyboard and screen-reader users get the date too; on touch screens (no
 *  hover) the same text shows as a small line under the chip. */
function statusCell(r: ZinvoiceTableRow): string {
  const id = `inv-tip-${r.number.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return tooltip({
    id, label: r.history, placement: "bottom", align: "end",
    contentHtml: `<span class="inv-status-chip" tabindex="0" aria-describedby="${esc(id)}">${rowChip(r)}</span>`,
  }) + `<span class="inv-status-note" aria-hidden="true">${esc(r.history)}</span>`;
}

/** Just the <tr>s — the page refreshes #inv-list out of band with these. */
export function zinvoiceTableRows(rows: ZinvoiceTableRow[]): string {
  return rows.map((r) => `
      <tr>
        <td><a class="inv-num-link" href="${esc(r.href)}">${esc(r.number)}</a></td>
        <td>${r.client ? esc(r.client) : "<em>No client</em>"}</td>
        <td class="inv-status-cell">${statusCell(r)}</td>
        <td class="num inv-amt">${esc(r.total)}</td>
      </tr>`).join("");
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
        <thead><tr><th scope="col">Number</th><th scope="col">Client</th><th scope="col">Status</th><th scope="col" class="num">Total</th></tr></thead>
        <tbody id="inv-list">${zinvoiceTableRows(o.rows)}</tbody>
      </table></div>`,
  });
}
