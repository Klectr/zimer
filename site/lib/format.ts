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

/** #330: "Invoiced" / "Draft" mark for time entries attached to an invoice.
 *  Returns null when the entry isn't on any invoice. Draft-attached time can
 *  still be freed (deleting the draft), so it gets the quieter treatment. */
export function entryInvoiceMark(e: { invoice_number: string | null; invoice_status: string | null }): {
  cls: string; label: string; title: string;
} | null {
  if (!e.invoice_number) return null;
  const draft = e.invoice_status === "draft";
  return {
    cls: draft ? "draft" : "",
    label: draft ? "Draft" : "Invoiced",
    title: draft
      ? `In draft ${e.invoice_number} — not billed yet`
      : `Invoiced on ${e.invoice_number}`,
  };
}

/**
 * #334: time on a sent/paid invoice is a frozen record — no edit, resize,
 * or delete. Draft-attached time stays editable (drafts are work-in-progress).
 */
export function entryIsLocked(e: { invoice_status: string | null }): boolean {
  return e.invoice_status === "sent" || e.invoice_status === "paid";
}

/** Payment-state pill for the invoice document itself (#222): the document
 *  only ever communicates Unpaid vs Paid — draft/sent are internal workflow. */
export function payPill(paid: boolean): string {
  return paid ? `<span class="pill pill-paid">Paid</span>`
              : `<span class="pill pill-unpaid">Unpaid</span>`;
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

/* #243: "Sep 11" or "Aug 31 – Sep 11" for invoice line-item dates.
   Parses YYYY-MM-DD manually — new Date("2026-09-11") is UTC midnight and
   renders the previous day in US timezones. */
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${SHORT_MONTHS[m - 1]} ${d}`;
}
export function shortDateRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from) return "";
  if (!to || to === from) return shortYmd(from);
  return `${shortYmd(from)} – ${shortYmd(to)}`;
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

/** Sunday of the week containing dateStr (or today). Returns YYYY-MM-DD. */
export function sundayOf(dateStr?: string): string {
  const base = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const day = base.getDay(); // 0 = Sunday
  const sun = new Date(base.getFullYear(), base.getMonth(), base.getDate() - day);
  return `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, "0")}-${String(sun.getDate()).padStart(2, "0")}`;
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

/* #293: payment terms are a fixed option list, not free text. Single source
 *  of truth: key → { label, days (null = no fixed window), description
 *  printed on invoices }. */
export const PAYMENT_TERMS = {
  due_on_receipt: { label: "Due on receipt", days: 0, description: "Payment is due upon receipt of this invoice." },
  net_7: { label: "Net 7", days: 7, description: "Payment is due within 7 days of the invoice date." },
  net_15: { label: "Net 15", days: 15, description: "Payment is due within 15 days of the invoice date." },
  net_30: { label: "Net 30", days: 30, description: "Payment is due within 30 days of the invoice date." },
  net_45: { label: "Net 45", days: 45, description: "Payment is due within 45 days of the invoice date." },
  net_60: { label: "Net 60", days: 60, description: "Payment is due within 60 days of the invoice date." },
  pay_when_paid: { label: "Pay-when-paid", days: null, description: "Due within 5 business days after the client receives customer payment." },
} as const;
export type PaymentTermsKey = keyof typeof PAYMENT_TERMS;
export const DEFAULT_PAYMENT_TERMS: PaymentTermsKey = "net_30";

export function isPaymentTermsKey(v: string | null | undefined): v is PaymentTermsKey {
  return typeof v === "string" && v.trim() in PAYMENT_TERMS;
}

/** Effective terms key: client terms → global terms → default. */
export function termsKey(clientTerms: string | null | undefined, globalTerms: string | null | undefined): PaymentTermsKey {
  if (isPaymentTermsKey(clientTerms)) return (clientTerms as string).trim() as PaymentTermsKey;
  if (isPaymentTermsKey(globalTerms)) return (globalTerms as string).trim() as PaymentTermsKey;
  return DEFAULT_PAYMENT_TERMS;
}

/** #291: terms key → numeric days, or null when the terms name no fixed
 *  window (pay-when-paid) or are unknown/blank (can't know → don't flag). */
export function termsDays(terms: string | null | undefined): number | null {
  const t = (terms ?? "").trim();
  return isPaymentTermsKey(t) ? PAYMENT_TERMS[t as PaymentTermsKey].days : null;
}

/** Canned description printed on the invoice for a terms key. */
export function termsDescription(terms: string | null | undefined): string {
  const t = (terms ?? "").trim();
  return isPaymentTermsKey(t) ? PAYMENT_TERMS[t as PaymentTermsKey].description : PAYMENT_TERMS[DEFAULT_PAYMENT_TERMS].description;
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
