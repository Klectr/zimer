/** Pure formatting helpers: escaping, money, dates, durations, CSV. No dependencies
 *  except the shared types (for entryToJson). */

import type { Entry } from "./types.ts";

/* ---------------- escaping / text ---------------- */
export function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function statusPill(status: string): string {
  const label = status[0].toUpperCase() + status.slice(1);
  return `<span class="pill pill-${esc(status)}">${esc(label)}</span>`;
}

/** Milestone 10: quote a CSV cell when it contains a comma, quote, or newline. */
export function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvResponse(body: string, filename: string): Response {
  return new Response("\ufeff" + body + "\n", { status: 200, headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  } });
}

/* ---------------- money ---------------- */
export const round2 = (n: number) => Math.round(n * 100) / 100;

export function money(n: number): string {
  return "$" + round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------------- dates ---------------- */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** Local-day bounds as ISO strings: YYYY-MM-DD in server-local time. */
export function dayBounds(dateStr: string): [string, string] {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0);
  return [start.toISOString(), end.toISOString()];
}

/** Monday of the week containing dateStr (or today). Returns YYYY-MM-DD. */
export function mondayOf(dateStr?: string): string {
  const base = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const day = (base.getDay() + 6) % 7; // 0 = Monday
  const mon = new Date(base.getFullYear(), base.getMonth(), base.getDate() - day);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Milestone 8: add n months to a YYYY-MM-DD date, clamped to month length. */
export function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(y, m - 1 + n, 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const day = Math.min(d, last);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Whole days between two YYYY-MM-DD dates (local). */
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  return Math.round((p(b).getTime() - p(a).getTime()) / 86400000);
}

/* ---------------- durations ---------------- */
export function durationSeconds(startIso: string, endIso: string | null): number {
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, Math.round((end - new Date(startIso).getTime()) / 1000));
}

export function fmtDur(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/* ---------------- API serialization ---------------- */
export function entryToJson(e: Entry) {
  return {
    id: e.id,
    project_id: e.project_id,
    description: e.description,
    start_time: e.start_time,
    end_time: e.end_time,
    duration_seconds: durationSeconds(e.start_time, e.end_time),
    project_name: e.project_name,
    client_name: e.client_name,
    client_color: e.client_color,
  };
}
