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
  verifyWebhookSignature: (
    payload: string,
    sig: string | null,
    secret: string
  ) => boolean;
  shareOrigin: (req: Request) => string;
}

export function createBillingRouter(deps: BillingDeps) {
  const { HOSTED, accounts, json, verifyWebhookSignature, shareOrigin } = deps;
  const billing: Billing | null = accounts ? createBilling(accounts) : null;

  async function handleBilling(
    req: Request,
    url: URL,
    path: string,
    method: string
  ): Promise<Response | null> {
    if (!path.startsWith("/billing/")) return null;
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
