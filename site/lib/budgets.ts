/** Project budget helpers (milestone 14.2): spend rollups, warn/over status,
 *  and the attention list. Reads through the Database passed in; the
 *  createBudgets() factory keeps existing call sites working unchanged.
 *  budgetAlertCard() is a view and stays with the views slice. */

import type { Database } from "bun:sqlite";
import { round2 } from "./format.ts";

export function createBudgets(db: Database) {
  function projectSpend(projectId: number): { hours: number; amount: number; rate: number } {
    const row = db.query(`
    SELECT COALESCE(SUM((strftime('%s', end_time) - strftime('%s', start_time)) / 3600.0), 0) AS hours,
           COALESCE(MAX(c.rate), 0) AS rate
    FROM time_entries e LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE e.project_id = ? AND e.end_time IS NOT NULL`).get(projectId) as any;
    const hours = round2(row.hours || 0);
    return { hours, rate: Number(row.rate || 0), amount: round2(hours * Number(row.rate || 0)) };
  }

  /* Milestone 14.2: budget status — null when under 80% of every budget. */
  function budgetStatus(p: any, spend: { hours: number; amount: number }): "warn" | "over" | null {
    const ratios: number[] = [];
    if (p.budget_hours) ratios.push(spend.hours / p.budget_hours);
    if (p.budget_amount) ratios.push(spend.amount / p.budget_amount);
    if (!ratios.length) return null;
    const worst = Math.max(...ratios);
    return worst >= 1 ? "over" : worst >= 0.8 ? "warn" : null;
  }

  /** Projects at >=80% of any budget, for the dashboard attention card. */
  function budgetAlerts(): any[] {
    const rows = db.query(`SELECT p.*, c.name AS client_name FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.budget_hours IS NOT NULL OR p.budget_amount IS NOT NULL`).all() as any[];
    return rows
      .map(p => ({ p, spend: projectSpend(p.id), status: budgetStatus(p, projectSpend(p.id)) }))
      .filter(r => r.status);
  }

  return { projectSpend, budgetStatus, budgetAlerts };
}
