/** Shared domain types. Dependency-free: every other module may import from here. */

export type Entry = {
  id: number;
  project_id: number | null;
  description: string;
  start_time: string;
  end_time: string | null;
  project_name: string | null;
  client_name: string | null;
  client_color: string | null;
  invoice_id: number | null;
  invoice_number: string | null; /* #330: LEFT JOIN invoices in ENTRY_SELECT */
  invoice_status: string | null; /* #330: "draft" | "sent" | "paid" | null */
};

export type InvoiceItem = { id: number; description: string; hours: number; rate: number; amount: number; date_from: string | null; date_to: string | null };

export type Invoice = {
  id: number; client_id: number | null; number: string; issue_date: string; due_date: string | null;
  status: string; tax_rate: number; notes: string; template: string; created_at: string;
  stripe_payment_link: string | null; paid_via_stripe: number; public_token: string | null;
  paid_at: string | null; /* #416: YYYY-MM-DD, set when marked paid (manual or Stripe) */
  client_name: string | null; client_color: string | null;
  client_payment_terms: string | null; /* #289: per-client terms, else global */
  internal_notes: string; /* #302: internal-only, never on client surfaces */
  pdf_snapshot: Uint8Array | null; /* #301: frozen at send, served verbatim */
  html_snapshot: string | null; /* #301: frozen at send, served verbatim */
};

export type RevenueRow = {
  id: number; number: string; due_date: string | null;
  status: string; tax_rate: number; issue_date: string;
  client_id: number | null; client_name: string | null; client_color: string | null;
  client_payment_terms: string | null;
  subtotal: number;
};

export type NewInvParams = {
  client_id: string; from: string; to: string; rate: string;
  number: string; issue_date: string; due_date: string; tax_rate: string; notes: string;
  internal_notes: string; /* #302 */
};
