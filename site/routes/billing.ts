/** #728: billing routes — kept in a separate router so the parallel #733
 *  work on web.ts doesn't conflict. Mounted in server.ts before handleWeb.
 *  Returns null when the path isn't a billing path.
 *
 *  - POST /billing/checkout (authed, HOSTED only): Stripe Checkout Session
 *    in subscription mode with a 14-day trial → 303 to Stripe.
 *  - GET /billing/portal (authed, HOSTED only): customer portal session
 *    (self-serve card update / cancel) → 303 to Stripe.
 *  - POST /billing/webhook: Stripe-signed, no auth. Updates the
 *    subscriptions table; signature verified before any DB access.
 *
 *  Subscription gating of pages/APIs is a follow-up after #733 lands —
 *  this slice stores state and exposes the purchase/manage flows only.
 */

import type { AccountsDb } from "../lib/accounts.ts";
import { logo } from "../lib/icons.ts";
import {
  createBilling,
  createCheckoutSession,
  createPortalSession,
  type Billing,
} from "../lib/billing.ts";

export interface BillingDeps {
  HOSTED: boolean;
  accounts: AccountsDb | null;
  json: (data: unknown, status?: number) => Response;
  html: (body: string, status?: number) => Response; /* #736: the /billing wall page */
  verifyWebhookSignature: (
    payload: string,
    sig: string | null,
    secret: string
  ) => boolean;
  shareOrigin: (req: Request) => string;
}

/* #736: shared hosted subscription gate for the page and API routers.
 *  inactiveAuthedUser(req) is true when the request carries a valid
 *  session whose user is past entitlement (Stripe row inactive per
 *  billingActive, pre-checkout trial honored). Self-host and
 *  unauthenticated requests are never gated. */
export function createSubscriptionGate(opts: {
  HOSTED: boolean;
  accounts: AccountsDb | null;
  billing: Billing | null;
}) {
  const { HOSTED, accounts, billing } = opts;
  function inactiveAuthedUser(req: Request): boolean {
    if (!HOSTED || !accounts || !billing) return false;
    const user = accounts.sessionUserFromRequest(req);
    if (!user) return false;
    const createdMs = Date.parse(user.created_at);
    return !billing.billingActive(
      user.id,
      Number.isFinite(createdMs) ? createdMs : null
    );
  }
  return { inactiveAuthedUser };
}

/** #736: the subscription wall. Minimal M3 public chrome (same as the
 *  login/signup pages): logo, status headline, what-happens-next copy,
 *  and one gold CTA to the customer portal. No app nav, no auth gate. */
function billingWallPage(status: string | null): string {
  const failed = status === "past_due";
  const headline = failed ? "Payment failed" : "Your trial ended";
  const copy = failed
    ? "Your last payment didn't go through, so Timekeep is paused until billing is current."
    : "Your 14-day trial has ended, so Timekeep is paused until you subscribe.";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${headline} · Timekeep</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script></head>
  <body><main class="login">
  <div class="md-card" style="border-radius:28px;padding:28px;max-width:420px">
  <h1 class="md-headline-small" style="margin-top:0;display:flex;align-items:center;gap:12px">${logo(32)}<span>Timekeep</span></h1>
  <h2 class="md-title-large" style="margin:0 0 8px">${headline}</h2>
  <p>${copy}</p>
  <p class="muted">Nothing is deleted — your time entries, clients, and invoices are saved and waiting.</p>
  <a class="md-filled-button" href="/billing/portal">Manage billing</a>
  <p class="muted tiny" style="margin-top:20px"><a href="/logout">Log out</a></p>
  </div></main></body></html>`;
}

export function createBillingRouter(deps: BillingDeps) {
  const { HOSTED, accounts, json, html, verifyWebhookSignature, shareOrigin } = deps;
  const billing: Billing | null = accounts ? createBilling(accounts) : null;

  async function handleBilling(
    req: Request,
    url: URL,
    path: string,
    method: string
  ): Promise<Response | null> {
    /* #736: exact /billing is the wall page; /billing/* are the JSON flows. */
    if (path !== "/billing" && !path.startsWith("/billing/")) return null;
    if (!HOSTED || !accounts || !billing) return json({ error: "not available" }, 404);

    /* ---- Stripe webhook: no session auth — verified by signature instead.
       Reads the raw body; signature is checked before any DB access. ---- */
    if (path === "/billing/webhook" && method === "POST") {
      const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
      if (!secret) return json({ error: "webhook not configured" }, 503);
      const payload = await req.text();
      if (!verifyWebhookSignature(payload, req.headers.get("stripe-signature"), secret))
        return json({ error: "invalid signature" }, 400);
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        return json({ error: "invalid payload" }, 400);
      }
      billing.upsertFromStripeEvent(event);
      return json({ received: true });
    }

    /* #736: billing wall — reachable with no session and no subscription
       gate, so the gate's 302 to here never loops. */
    if (path === "/billing" && method === "GET") {
      const viewer = accounts.sessionUserFromRequest(req);
      const sub = viewer ? billing.getSubscriptionStatus(viewer.id) : null;
      return html(billingWallPage(sub?.status ?? null));
    }

    const user = accounts.sessionUserFromRequest(req);
    if (!user) return json({ error: "unauthorized" }, 401);

    if (path === "/billing/checkout" && method === "POST") {
      const existing = billing.getSubscriptionStatus(user.id);
      if (existing && billing.subscriptionActive(user.id)) {
        return json(
          { error: "Already subscribed — manage it in the customer portal." },
          409
        );
      }
      if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
        return json({ error: "billing not configured" }, 503);
      }
      try {
        const { url: checkoutUrl } = await createCheckoutSession({
          userId: user.id,
          email: user.email,
          origin: shareOrigin(req),
        });
        return Response.redirect(checkoutUrl, 303);
      } catch (err: any) {
        return json({ error: err?.message || "checkout failed" }, 502);
      }
    }

    if (path === "/billing/portal" && method === "GET") {
      const sub = billing.getSubscriptionStatus(user.id);
      if (!sub?.stripe_customer_id) {
        return json({ error: "No subscription yet — check out first." }, 409);
      }
      if (!process.env.STRIPE_SECRET_KEY) {
        return json({ error: "billing not configured" }, 503);
      }
      try {
        const { url: portalUrl } = await createPortalSession({
          customerId: sub.stripe_customer_id,
          returnUrl: shareOrigin(req),
        });
        return Response.redirect(portalUrl, 303);
      } catch (err: any) {
        return json({ error: err?.message || "portal failed" }, 502);
      }
    }

    return json({ error: "not found" }, 404);
  }

  return { handleBilling, billing };
}
