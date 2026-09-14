/** Recurring-invoice schedule math (milestone 8): pure date helpers.
 *  Generation itself lives in the routes slice; these are dependency-free. */

import { addDays, addMonths } from "./format.ts";

/** Milestone 8: first run date for a new schedule anchored at `from` (YYYY-MM-DD). */
export function firstRun(frequency: string, dayOfMonth: number | null, from: string): string {
  if (frequency === "biweekly") return addDays(from, 14);
  const dom = Math.min(Math.max(dayOfMonth || 1, 1), 28);
  const [y, mo] = from.split("-").map(Number);
  const cand = `${y}-${String(mo).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
  return cand > from ? cand : addMonths(cand, 1);
}

/** Milestone 8: advance a schedule's next_run one period. */
export function advanceRun(s: { frequency: string; next_run: string }): string {
  return s.frequency === "biweekly" ? addDays(s.next_run, 14) : addMonths(s.next_run, 1);
}

/** Milestone 8: start of the billing period ending at next_run. */
export function periodStart(s: { frequency: string; next_run: string }): string {
  return s.frequency === "biweekly" ? addDays(s.next_run, -14) : addMonths(s.next_run, -1);
}
