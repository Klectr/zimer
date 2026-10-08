/** #728: hosted subscription billing — subscription state lives in accounts.db
 *  next to users/sessions. Zero-dependency Stripe: plain fetch to
 *  api.stripe.com, no SDK (same ethos as site/stripe.ts).
 *
 *  Offer: $12/mo, one tier, 14-day trial. The price id comes from the
 *  STRIPE_PRICE_ID env var (created in the Stripe dashboard) — never
 *  hardcoded here.
 *
 *  Grace rules (subscriptionActive):
 *    - trialing / active              → active
 *    - past_due                       → active for 7 days after the failed
 *                                       period end, then blocked
 *    - canceled                       → stays active until current_period_end
 *                                       (covers cancel-at-end), blocked after
 *    - no row                         → not active
 *
 *  #736: the page/API subscription gate uses billingActive instead — same
 *  rules, plus a pre-checkout trial: a user with NO subscription row yet
 *  counts as trialing for 14 days from user.created_at (the $12/mo
 *  14-day-trial offer, no Stripe subscription needed). A row that exists
 *  but is inactive (unpaid, expired…) grants nothing — the trial only
 *  covers users who never checked out.
 *
 *  Live Stripe calls were NOT tested (no key in this environment) — all
 *  Stripe API traffic is covered by mocked-fetch unit tests.
 */

import type { AccountsDb } from "./accounts.ts";

export const TRIAL_DAYS = 14;
export const PAST_DUE_GRACE_DAYS = 7;
/** #923: the trial-expiry nudge banner appears while this many whole days
 *  (or fewer) of the pre-checkout trial remain. */
export const TRIAL_NUDGE_DAYS = 3;

export interface Subscription {
  user_id: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string | null; /* Stripe subscription status */
  trial_ends_at: string | null;
  current_period_end: string | null;
  updated_at: string;
}

const isoFromUnix = (ts: number | null | undefined): string | null =>
  typeof ts === "number" && Number.isFinite(ts)
    ? new Date(ts * 1000).toISOString()
    : null;

function stripeCfg() {
  return {
    apiBase: (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, ""),
    secret: process.env.STRIPE_SECRET_KEY || "",
    priceId: process.env.STRIPE_PRICE_ID || "",
  };
}

/** POST a form-encoded Stripe API call. Throws on transport or Stripe errors. */
export async function stripePost(path: string, params: URLSearchParams): Promise<any> {
  const { apiBase, secret } = stripeCfg();
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`${apiBase}/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error?.message || `Stripe request failed (${res.status})`);
  return data;
}

/** Create a hosted Checkout Session in subscription mode. Stripe collects
 *  the card and creates the customer + subscription; the webhook upserts
 *  the local row via subscription_data metadata.
 *
 *  Trial anchoring (#783): the free trial is ONE 14-day window starting at
 *  signup. trialEndMs pins the Stripe trial to that window (unix seconds in
 *  `trial_end`) so checking out mid-trial doesn't stack a second free
 *  trial. When trialEndMs is null it defaults to 14 days from now; when
 *  it's already past, no trial params are sent and billing starts
 *  immediately. #787: the pinned end is rounded up to the next UTC
 *  midnight so Stripe's whole-day trial display reads 14, not 13. */
export async function createCheckoutSession(opts: {
  userId: number;
  email: string;
  origin: string;
  trialEndMs?: number | null;
  customerId?: string | null;
}): Promise<{ url: string }> {
  const { priceId } = stripeCfg();
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");
  const trialEnd =
    opts.trialEndMs ?? Date.now() + TRIAL_DAYS * 24 * 3600 * 1000;
  const p = new URLSearchParams();
  p.set("mode", "subscription");
  p.set("line_items[0][price]", priceId);
  p.set("line_items[0][quantity]", "1");
  if (trialEnd > Date.now() + 60 * 1000) {
    /* #785: on Checkout Sessions the trial end lives under
       subscription_data — a top-level trial_end 400s ("unknown
       parameter"; that's the Subscriptions API).
       #787: round UP to the next UTC midnight. Stripe's checkout page
       floors the remaining trial to whole days, so an exact
       signup+14d reads as "13 days" minutes after signup. Rounding up
       keeps the advertised 14 days while staying anchored to the
       original signup window (checking out late still can't extend
       the trial). */
    const rounded = Math.ceil(trialEnd / 86400000) * 86400000;
    p.set("subscription_data[trial_end]", String(Math.floor(rounded / 1000)));
  }
  if (opts.customerId) p.set("customer", opts.customerId);
  else p.set("customer_email", opts.email);
  p.set("client_reference_id", String(opts.userId));
  p.set("subscription_data[metadata][user_id]", String(opts.userId));
  p.set("success_url", `${opts.origin}/?billing=success`);
  p.set("cancel_url", `${opts.origin}/?billing=cancelled`);
  const session = await stripePost("checkout/sessions", p);
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: String(session.url) };
}

/** Create a customer-portal session (self-serve card update / cancel). */
export async function createPortalSession(opts: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const p = new URLSearchParams();
  p.set("customer", opts.customerId);
  p.set("return_url", opts.returnUrl);
  const session = await stripePost("billing_portal/sessions", p);
  if (!session.url) throw new Error("Stripe did not return a portal URL");
  return { url: String(session.url) };
}

export function createBilling(accounts: AccountsDb) {
  const db = accounts.db;
  db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT,
  trial_ends_at TEXT,
  current_period_end TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscription ON subscriptions(stripe_subscription_id);
`);

  const qByUser = db.query("SELECT * FROM subscriptions WHERE user_id = ?");
  const qBySub = db.query(
    "SELECT * FROM subscriptions WHERE stripe_subscription_id = ?"
  );

  function getSubscriptionStatus(userId: number): Subscription | null {
    return (qByUser.get(userId) as Subscription | null) ?? null;
  }

  /** Is this user currently entitled to the hosted product? */
  function subscriptionActive(userId: number, now: Date = new Date()): boolean {
    const s = getSubscriptionStatus(userId);
    if (!s || !s.status) return false;
    const nowMs = now.getTime();
    const periodEndMs = s.current_period_end ? Date.parse(s.current_period_end) : NaN;
    switch (s.status) {
      case "trialing":
      case "active":
        return true;
      case "past_due":
        /* 7-day grace after the failed period end, then blocked. */
        return (
          Number.isFinite(periodEndMs) &&
          nowMs < periodEndMs + PAST_DUE_GRACE_DAYS * 24 * 3600 * 1000
        );
      case "canceled":
        /* Cancel-at-end: stays active until the paid period runs out. */
        return Number.isFinite(periodEndMs) && nowMs < periodEndMs;
      default:
        /* incomplete, incomplete_expired, unpaid, paused: not entitled. */
        return false;
    }
  }

  /** #736: entitlement for the hosted subscription gate. Same rules as
   *  subscriptionActive, plus the pre-checkout trial: no row → trialing
   *  for TRIAL_DAYS from signup (userCreatedAtMs, epoch ms; null = no
   *  trial grant). A row that exists but is inactive stays inactive. */
  function billingActive(
    userId: number,
    userCreatedAtMs: number | null,
    now: Date = new Date()
  ): boolean {
    if (subscriptionActive(userId, now)) return true;
    if (getSubscriptionStatus(userId)) return false;
    if (!Number.isFinite(userCreatedAtMs)) return false;
    return now.getTime() < (userCreatedAtMs as number) + TRIAL_DAYS * 24 * 3600 * 1000;
  }

  function upsertRow(row: {
    user_id: number;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    status?: string | null;
    trial_ends_at?: string | null;
    current_period_end?: string | null;
  }): void {
    db.query(
      `INSERT INTO subscriptions
         (user_id, stripe_customer_id, stripe_subscription_id, status,
          trial_ends_at, current_period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         status = excluded.status,
         trial_ends_at = excluded.trial_ends_at,
         current_period_end = excluded.current_period_end,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).run(
      row.user_id,
      row.stripe_customer_id ?? null,
      row.stripe_subscription_id ?? null,
      row.status ?? null,
      row.trial_ends_at ?? null,
      row.current_period_end ?? null
    );
  }

  /** Apply a customer.subscription.* event object to the local row.
   *  Returns the user id it was applied to, or null when the event
   *  couldn't be attributed to a user. */
  function upsertFromSubscription(sub: any): number | null {
    const metaUserId = Number(sub?.metadata?.user_id || 0);
    let userId = Number.isFinite(metaUserId) && metaUserId > 0 ? metaUserId : 0;
    if (!userId && sub?.id) {
      const existing = qBySub.get(String(sub.id)) as Subscription | null;
      if (existing) userId = existing.user_id;
    }
    if (!userId) return null;
    upsertRow({
      user_id: userId,
      stripe_customer_id: sub.customer ? String(sub.customer) : null,
      stripe_subscription_id: sub.id ? String(sub.id) : null,
      status: sub.status ? String(sub.status) : null,
      trial_ends_at: isoFromUnix(sub.trial_end),
      current_period_end: isoFromUnix(sub.current_period_end),
    });
    return userId;
  }

  /** Apply one Stripe webhook event. Returns true when the event type is
   *  one we handle (even if attribution failed), false for unknown types. */
  function upsertFromStripeEvent(event: any): boolean {
    const type = String(event?.type || "");
    const obj = event?.data?.object || {};
    switch (type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        upsertFromSubscription(obj);
        return true;
      case "customer.subscription.deleted": {
        const userId = upsertFromSubscription(obj);
        if (userId) {
          db.query("UPDATE subscriptions SET status = 'canceled' WHERE user_id = ?").run(
            userId
          );
        }
        return true;
      }
      case "invoice.payment_failed": {
        /* Belt-and-braces: the subscription.updated event normally carries
           past_due already, but invoices can fail first. */
        const subId = obj.subscription ? String(obj.subscription) : "";
        if (subId) {
          const existing = qBySub.get(subId) as Subscription | null;
          if (existing) {
            db.query(
              "UPDATE subscriptions SET status = 'past_due', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?"
            ).run(existing.user_id);
          }
        }
        return true;
      }
      case "customer.subscription.trial_will_end":
        /* No email sending in timekeep (product decision) — acknowledged
           and ignored; the status stays trialing until updated. */
        return true;
      case "checkout.session.completed": {
        /* #783: Stripe redirects the buyer back the moment checkout
           completes, but customer.subscription.created can lag a few
           seconds behind. Upsert a provisional trialing row from the
           session so the subscription gate passes immediately; the
           subscription events correct the row (trial_ends_at, period
           end) when they arrive. */
        const session = obj as any;
        const metaUserId = Number(
          session?.client_reference_id || session?.metadata?.user_id || 0
        );
        let userId =
          Number.isFinite(metaUserId) && metaUserId > 0 ? metaUserId : 0;
        if (!userId && session?.customer) {
          const existing = db
            .query("SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?")
            .get(String(session.customer)) as { user_id: number } | null;
          if (existing) userId = existing.user_id;
        }
        if (userId && session?.subscription && !qByUser.get(userId)) {
          upsertRow({
            user_id: userId,
            stripe_customer_id: session.customer
              ? String(session.customer)
              : null,
            stripe_subscription_id: String(session.subscription),
            status: "trialing",
          });
        }
        return true;
      }
      default:
        return false;
    }
  }

  return {
    getSubscriptionStatus,
    subscriptionActive,
    billingActive, /* #736 */
    upsertFromSubscription,
    upsertFromStripeEvent,
  };
}

/** #923: whole days of the pre-checkout trial remaining (ceiling), or null
 *  when there is no pre-checkout trial in progress: a subscription row
 *  exists (the user checked out, or did and lapsed — the nudge is only for
 *  never-checked-out trials), the 14-day window elapsed, or created_at is
 *  unknown. billingActive() already encodes the window; the row check
 *  restricts this to the pre-checkout case the nudge is about. */
export function trialDaysLeft(
  billing: Billing,
  userId: number,
  userCreatedAtMs: number | null,
  nowMs: number = Date.now()
): number | null {
  if (billing.getSubscriptionStatus(userId)) return null;
  if (!billing.billingActive(userId, userCreatedAtMs, new Date(nowMs))) return null;
  const trialEndMs = (userCreatedAtMs as number) + TRIAL_DAYS * 24 * 3600 * 1000;
  return Math.ceil((trialEndMs - nowMs) / (24 * 3600 * 1000));
}

export type Billing = ReturnType<typeof createBilling>;
