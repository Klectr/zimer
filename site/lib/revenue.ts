/** Revenue domain logic (milestone 1 + milestone 7 overdue): totals, monthly trend,
 *  per-client breakdown, overdue detection. Reads through the prepared
 *  qRevenueRows statement passed in; the createRevenue() factory keeps every
 *  existing call site working unchanged. */

import type { Statement } from "bun:sqlite";
import type { RevenueRow } from "./types.ts";
import { round2, todayStr, daysBetween, termsDays } from "./format.ts";

export function createRevenue(qRevenueRows: Statement, getGlobalTerms: () => string) {
  const revenueTotal = (r: RevenueRow) => round2(r.subtotal * (1 + (r.tax_rate || 0) / 100));

  /** A1: top-level revenue totals, tax-inclusive. */
  function revenueTotals() {
    const rows = qRevenueRows.all() as RevenueRow[];
    const invoiced = round2(rows.reduce((a, r) => a + revenueTotal(r), 0));
    const paid = round2(rows.filter(r => r.status === "paid").reduce((a, r) => a + revenueTotal(r), 0));
    return { invoiced, paid, outstanding: round2(invoiced - paid) };
  }

  /** A2: trailing 12-month revenue (tax-inclusive), oldest → newest. */
  function revenueMonthly() {
    const rows = qRevenueRows.all() as RevenueRow[];
    const now = new Date();
    const months: { month: string; label: string; invoiced: number; paid: number }[] = [];
    for (let k = 11; k >= 0; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      months.push({
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-US", { month: "short" }),
        invoiced: 0, paid: 0,
      });
    }
    for (const r of rows) {
      const m = months.find(m => m.month === String(r.issue_date).slice(0, 7));
      if (!m) continue;
      const t = revenueTotal(r);
      m.invoiced = round2(m.invoiced + t);
      if (r.status === "paid") m.paid = round2(m.paid + t);
    }
    return months;
  }

  /** A3: per-client revenue (tax-inclusive), sorted by invoiced desc. */
  function revenueByClient() {
    const rows = qRevenueRows.all() as RevenueRow[];
    const map = new Map<number, { client_id: number; name: string; color: string | null; invoiced: number; paid: number }>();
    for (const r of rows) {
      if (r.client_id == null) continue;
      const e = map.get(r.client_id) ?? {
        client_id: r.client_id, name: r.client_name || "Unknown",
        color: r.client_color, invoiced: 0, paid: 0,
      };
      const t = revenueTotal(r);
      e.invoiced = round2(e.invoiced + t);
      if (r.status === "paid") e.paid = round2(e.paid + t);
      map.set(r.client_id, e);
    }
    return [...map.values()]
      .map(e => ({ ...e, outstanding: round2(e.invoiced - e.paid) }))
      .sort((a, b) => b.invoiced - a.invoiced);
  }

  /** Milestone 7: an invoice is overdue when sent with a past due date.
   *  #291: only when the effective payment terms name a numeric window —
   *  pay-when-paid terms define no due date the app can enforce, so they
   *  never flag. Effective terms = client terms, else the global setting. */
  function isOverdue(r: { status: string; due_date: string | null; client_payment_terms?: string | null }): boolean {
    if (r.status !== "sent" || !r.due_date || (r.due_date as string) >= todayStr()) return false;
    return termsDays(r.client_payment_terms || getGlobalTerms()) !== null;
  }

  /** Milestone 7: overdue invoices — sent, with a past due_date — tax-inclusive, most overdue first. */
  function revenueOverdue() {
    const today = todayStr();
    return (qRevenueRows.all() as RevenueRow[])
      .filter(r => isOverdue(r))
      .map(r => {
        const days = daysBetween(r.due_date as string, today);
        return {
          id: r.id, number: r.number, client_name: r.client_name,
          total: revenueTotal(r), due_date: r.due_date,
          days_past_due: days,
          bucket: days <= 15 ? "1-15" : days <= 30 ? "16-30" : "31+",
        };
      })
      .sort((a, b) => b.days_past_due - a.days_past_due);
  }

  return { revenueTotal, revenueTotals, revenueMonthly, revenueByClient, isOverdue, revenueOverdue };
}
