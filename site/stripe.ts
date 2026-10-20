/**
 * Stripe integration — plain fetch, no SDK (zero-dependency ethos).
 *
 * Test seam: STRIPE_API_BASE overrides the API host (default https://api.stripe.com).
 * Secrets live only in env vars, never in the DB, logs, or chat.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const API_BASE = process.env.STRIPE_API_BASE || "https://api.stripe.com";
const SECRET = process.env.STRIPE_SECRET_KEY || "";

export function stripeConfigured(): boolean {
  return !!SECRET;
}

export type StripeLinkResult = { id: string; url: string };

/** Create a one-line-item Payment Link for an invoice total. Throws on Stripe errors. */
export async function createPaymentLink(opts: {
  invoiceId: number;
  number: string;
  clientName: string;
  totalCents: number;
}): Promise<StripeLinkResult> {
  const params = new URLSearchParams();
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(opts.totalCents));
  params.set(
    "line_items[0][price_data][product_data][name]",
    `Invoice ${opts.number}${opts.clientName ? ` — ${opts.clientName}` : ""}`
  );
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[invoice_id]", String(opts.invoiceId));

  const res = await fetch(`${API_BASE}/v1/payment_links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error?.message || `Stripe request failed (${res.status})`);
  if (!data.url) throw new Error("Stripe did not return a payment link URL");
  return { id: String(data.id || ""), url: String(data.url) };
}

/**
 * Verify a Stripe webhook signature (v1 HMAC-SHA256 scheme) with timestamp
 * tolerance. Returns false on any malformed input — never throws.
 */
export function verifyWebhookSignature(
  payload: string,
  header: string | null,
  secret: string
): boolean {
  if (!header || !secret) return false;
  let t: string | undefined;
  const v1s: string[] = [];
  for (const p of header.split(",")) {
    const i = p.indexOf("=");
    if (i <= 0) continue;
    const k = p.slice(0, i).trim();
    /* #988: during a secret rotation Stripe sends several v1 signatures —
       keep them all and accept a match against any, like Stripe's own libs. */
    if (k === "t") t = p.slice(i + 1).trim();
    else if (k === "v1") v1s.push(p.slice(i + 1).trim());
  }
  if (!t || v1s.length === 0) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  return v1s.some((v1) => {
    const actual = Buffer.from(v1, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}
