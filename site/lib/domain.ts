/** Shared domain helpers: invoice numbering, line-item grouping (fixed
 *  5-minute billable rounding), public/portal tokens, Stripe payment links, project
 *  options and progress bars. Wired once in
 *  server.ts and injected into the route and view factories that need them. */

import { randomBytes } from "node:crypto";
import type { Database, Statement } from "bun:sqlite";
import { addDays, durationSeconds, esc, fmtDur, money, round2 } from "./format.ts";
import type { Entry, Invoice, InvoiceItem } from "./types.ts";
import { createPaymentLink, stripeConfigured } from "../stripe.ts";

export interface DomainDeps {
  db: Database;
  qInvoice: Statement;
  qInvoiceItems: Statement;
  TOKEN: string;
}

/** Pixels per hour in the calendar time grid. */
export const CAL_HOUR_PX = 52;

/** Weekly hours target: 40h matches the ~80h biweekly invoicing pace.
    Kept as a constant in this slice; a configurable target is a follow-up. */
export const WEEK_TARGET_SECS = 40 * 3600;

/** Daily hours target: 8h, matching the calendar's under-8h-day pacing (#22). */
export const DAY_TARGET_SECS = 8 * 3600;

export function createDomain(deps: DomainDeps) {
  const { db, qInvoice, qInvoiceItems, TOKEN } = deps;

  /* ---------------- invoicing helpers ---------------- */

  function getInvoice(id: number): (Invoice & { items: InvoiceItem[] }) | null {
    const inv = qInvoice.get(id) as Invoice | null;
    if (!inv) return null;
    const items = qInvoiceItems.all(id) as InvoiceItem[];
    return { ...inv, items };
  }

  /** Random public share token: 24 bytes = 192 bits of entropy, URL-safe. */
  function newPublicToken(): string {
    return randomBytes(24).toString("base64url");
  }

  /** Mint and persist a public share token for an invoice if it lacks one. */
  function ensurePublicToken(id: number): string {
    return getPublicToken(id) ?? mintPublicToken(id);
  }

  /** Milestone 12: per-client portal token, minted on demand. */
  function getPortalToken(clientId: number): string | null {
    return (db.query("SELECT portal_token FROM clients WHERE id = ?").get(clientId) as any)?.portal_token ?? null;
  }
  function ensurePortalToken(clientId: number): string {
    const existing = getPortalToken(clientId);
    if (existing) return existing;
    for (let i = 0; i < 5; i++) {
      const tok = newPublicToken();
      try {
        db.query("UPDATE clients SET portal_token = ? WHERE id = ?").run(tok, clientId);
        return tok;
      } catch { /* collision — retry */ }
    }
    throw new Error("could not mint portal token");
  }

  /** Current public share token for an invoice, or null if none (never mints). */
  function getPublicToken(id: number): string | null {
    return (db.query("SELECT public_token FROM invoices WHERE id = ?").get(id) as any)?.public_token ?? null;
  }

  /** Mint a fresh public share token, replacing any existing one. */
  function mintPublicToken(id: number): string {
    for (let i = 0; i < 5; i++) {
      const tok = newPublicToken();
      try {
        db.query("UPDATE invoices SET public_token = ? WHERE id = ?").run(tok, id);
        return tok;
      } catch { /* token collision — retry */ }
    }
    throw new Error("could not mint public token");
  }

  /* Milestone 20: publicOrigin lives in lib/http.ts. */



  function invoiceTotals(items: InvoiceItem[], taxRate: number) {
    const subtotal = round2(items.reduce((a, it) => a + it.amount, 0));
    const tax = round2(subtotal * taxRate / 100);
    return { subtotal, tax, total: round2(subtotal + tax) };
  }

  function nextInvoiceNumber(): string {
    const r = db.query("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM invoices").get() as any;
    return "INV-" + String(r.n).padStart(4, "0");
  }

  /** Create (or regenerate) a Stripe payment link for a sent invoice. */
  async function stripeLinkFor(id: number): Promise<{ url?: string; error?: string; status?: number }> {
    const inv = qInvoice.get(id) as Invoice | null;
    if (!inv) return { error: "not found", status: 404 };
    if (inv.status !== "sent") return { error: "only sent invoices can collect via Stripe", status: 400 };
    if (!stripeConfigured()) return { error: "STRIPE_SECRET_KEY not configured", status: 503 };
    const full = getInvoice(id)!;
    const t = invoiceTotals(full.items, full.tax_rate);
    try {
      const link = await createPaymentLink({
        invoiceId: id,
        number: inv.number,
        clientName: inv.client_name || "",
        totalCents: Math.round(t.total * 100),
      });
      db.query("UPDATE invoices SET stripe_payment_link = ? WHERE id = ?").run(link.url, id);
      return { url: link.url };
    } catch (e: any) {
      return { error: e?.message || "Stripe request failed", status: 502 };
    }
  }

  /* Milestone 20: revenue domain logic lives in lib/revenue.ts. */

  /** Unbilled, finished entries for a client's projects inside [from, to). */
  function unbilledEntries(clientId: number, from: string, to: string) {
    return db.query(
      `SELECT e.id, e.project_id, e.description, e.start_time, e.end_time,
              p.name AS project_name
       FROM time_entries e
       JOIN projects p ON p.id = e.project_id
       WHERE e.invoice_id IS NULL AND e.end_time IS NOT NULL
         AND p.client_id = ? AND e.start_time >= ? AND e.start_time < ?
       ORDER BY e.start_time`).all(clientId, from, to) as any[];
  }

  /** Fixed billable rounding, minutes. Every invoice rounds each entry's
      duration UP to the next increment (issue #199). */
  const ROUNDING_MINUTES = 5;

  /** Group entries by project into draft line items. */
  function groupToLineItems(entries: any[], rate: number) {
    const groups = new Map<number, { project: string; ids: number[]; secs: number }>();
    for (const e of entries) {
      const g = groups.get(e.project_id) ?? { project: e.project_name, ids: [], secs: 0 };
      g.ids.push(e.id);
      g.secs += roundUpSeconds(durationSeconds(e.start_time, e.end_time), ROUNDING_MINUTES);
      groups.set(e.project_id, g);
    }
    return [...groups.values()].map(g => {
      const hours = round2(g.secs / 3600);
      return { description: g.project, hours, rate, amount: round2(hours * rate), entry_ids: g.ids };
    });
  }

  /* Milestone 20: statusPill lives in lib/format.ts. */

  /* Milestone 20: auth lives in lib/auth.ts. */

  /* ---------------- views ---------------- */
  function projectOptions(selected: number | null = null): string {
    const rows = db.query(
      `SELECT p.id, p.name, c.name AS client FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.name`).all() as any[];
    return rows.map(r =>
      `<option value="${r.id}"${r.id === selected ? " selected" : ""}>${esc(r.name)}${r.client ? ` (${esc(r.client)})` : ""}</option>`
    ).join("");
  }










  /* Milestone 20: mondayOf/addDays live in lib/format.ts. */

  /** Shared M3 Expressive determinate progress track (#87). Under target: a
      wave-masked gold fill that ripples while motion is allowed, a tonal
      remainder track, and a small gold gap dot. At/over target: settles to a
      flat full-width gold fill with a one-pass completion sheen. `pct` is
      clamped 0..100; `met` selects the settled state. */
  function m3ProgressBar(pct: number, met: boolean, ariaLabel: string): string {
    const bar = met
      ? `<div class="m3-progress-fill" style="width:${pct.toFixed(1)}%" aria-hidden="true"></div>`
      : `${pct > 0 ? `<div class="m3-progress-fill-wrap" style="width:calc((100% - 4px) * ${(pct / 100).toFixed(3)})" aria-hidden="true"><div class="m3-progress-fill-wave"></div></div>` : ""}
         <div class="m3-progress-remainder" aria-hidden="true"></div>
         <div class="m3-progress-dot" aria-hidden="true"></div>`;
    return `<div class="m3-progress-track${met ? " complete" : ""}" role="progressbar" aria-valuenow="${Math.round(pct)}"
        aria-valuemin="0" aria-valuemax="100" aria-label="${ariaLabel}">${bar}</div>`;
  }

  /** Slim pacing bar under the week header: tracked hours vs the 40h target. */
  function weekTargetBar(weekTotalSecs: number): string {
    const pct = Math.min(100, (weekTotalSecs / WEEK_TARGET_SECS) * 100);
    const over = weekTotalSecs >= WEEK_TARGET_SECS;
    return `
      <div class="m3-progress week-target">
        ${m3ProgressBar(pct, over, "Weekly hours target, 40 hours")}
        <div class="md-label-medium muted m3-progress-label">${fmtDur(weekTotalSecs)} / 40h${over ? ` · <span class="tiny">over target</span>` : ""}</div>
      </div>`;
  }











  /** /invoices — list of invoices with status pills and totals. */
  /* Issue #199: round a duration UP to the next increment (per-entry billing).
     Fixed 5-minute increments; minutes <= 0 or null => no rounding. */
  function roundUpSeconds(secs: number, minutes: number | null | undefined): number {
    const m = Number(minutes) || 0;
    if (m <= 0 || secs <= 0) return secs;
    const inc = m * 60;
    return Math.ceil(secs / inc) * inc;
  }


  return {
    getInvoice, invoiceTotals, nextInvoiceNumber, stripeLinkFor,
    unbilledEntries, groupToLineItems,
    projectOptions, m3ProgressBar, weekTargetBar,
    newPublicToken, ensurePublicToken, getPublicToken, mintPublicToken,
    getPortalToken, ensurePortalToken,
  };
}
