/** #728: billing routes — kept in a separate router so the parallel #733
 *  work on web.ts doesn't conflict. Mounted in server.ts before handleWeb.
 *  Returns null when the path isn't a billing path.
 *
 *  - POST /billing/checkout (authed, HOSTED only): Stripe Checkout Session
 *    in subscription mode with a 14-day trial → 303 to Stripe.
 *  - POST /billing/portal (authed, HOSTED only): customer portal session
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
  TRIAL_DAYS,
  type Billing,
  type Subscription,
} from "../lib/billing.ts";
import { originMatches } from "../lib/http.ts"; /* #912 */
import { settingsSection } from "../ui/settings-section.ts";
import { planCard } from "../ui/plan-card.ts";
import { tag } from "../ui/tag.ts";
import { button } from "../ui/button.ts";
import { card } from "../ui/card.ts";
import { logoLockup } from "../ui/logo-lockup.ts";
import { shortYmd } from "../lib/format.ts";

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

/* #1121: the mock's Billing section for the settings body — plan line,
 * status tag, and the manage/subscribe action. Hosted only; self-host
 * and signed-out requests render nothing. The CTA follows #783: users
 * with a Stripe customer get the portal, everyone else checkout. */
export function createBillingSection(opts: {
  HOSTED: boolean;
  accounts: AccountsDb | null;
  billing: Billing | null;
}) {
  const { HOSTED, accounts, billing } = opts;
  return function billingSectionHtml(req: Request): string {
    if (!HOSTED || !accounts || !billing) return "";
    const user = accounts.sessionUserFromRequest(req);
    if (!user) return "";
    const sub = billing.getSubscriptionStatus(user.id);
    const day = (iso: string | null | undefined) => (iso ? shortYmd(iso.slice(0, 10)) : null);
    let statusTag: string;
    let line: string;
    if (!sub) {
      const createdMs = Date.parse(user.created_at);
      const trialEndMs = createdMs + TRIAL_DAYS * 24 * 3600 * 1000;
      if (Number.isFinite(createdMs) && Date.now() < trialEndMs) {
        statusTag = tag({ label: "Trial", tone: "primary" });
        line = `Trial ends ${day(new Date(trialEndMs).toISOString())}. Subscribe any time to keep your data flowing.`;
      } else {
        statusTag = tag({ label: "No subscription", tone: "neutral" });
        line = "Subscribe to keep using Zimer.";
      }
    } else if (sub.status === "trialing") {
      statusTag = tag({ label: "Trialing", tone: "primary" });
      line = sub.trial_ends_at ? `Trial ends ${day(sub.trial_ends_at)}.` : "Your trial is running.";
    } else if (sub.status === "active") {
      statusTag = tag({ label: "Active", tone: "success" });
      line = sub.current_period_end ? `Next charge ${day(sub.current_period_end)}. Early rate locked — your price doesn't rise when new signups move up.` : "Your plan is active.";
    } else if (sub.status === "past_due") {
      statusTag = tag({ label: "Past due", tone: "error" });
      line = "Your last payment failed — update your card to keep Zimer running.";
    } else if (sub.status === "canceled") {
      statusTag = tag({ label: "Canceled", tone: "neutral" });
      const end = day(sub.current_period_end);
      line = end && Date.parse(sub.current_period_end!) > Date.now() ? `Access runs until ${end}.` : "Your subscription has ended.";
    } else {
      statusTag = tag({ label: sub.status || "Unknown", tone: "neutral" });
      line = "Manage your subscription in the billing portal.";
    }
    const action = sub?.stripe_customer_id
      ? `<form method="post" action="/billing/portal" style="margin:0">${button({ label: "Manage subscription", type: "submit" })}</form>`
      : `<form method="post" action="/billing/checkout" style="margin:0">${button({ label: "Subscribe · $12/month", type: "submit", variant: "primary" })}</form>`;
    const body = planCard({
      amount: "$12",
      period: "/ month · flat, no seats",
      blurb: line,
      features: [],
      ctaHtml: action,
      statusHtml: statusTag,
      bare: true,
    });
    return settingsSection({ level: 2, id: "billing-section", title: "Billing — Hosted plan", bodyHtml: body });
  };
}

/** #736: the subscription wall. Minimal ui public chrome (same shell as
 *  the login/signup pages): logo, status headline, what-happens-next copy,
 *  and one pumpkin CTA. No app nav, no auth gate.
 *
 *  #783: the CTA depends on Stripe state. Past-due users have a customer,
 *  so they get the portal. Everyone else gets a Subscribe button that
 *  POSTs to /billing/checkout — the old portal link 409'd for users with
 *  no Stripe customer, leaving no way to subscribe at all. */
function billingWallPage(sub: Subscription | null): string {
  const failed = sub?.status === "past_due";
  const headline = failed ? "Payment failed" : "Your trial ended";
  const copy = failed
    ? "Your last payment didn't go through, so Zimer is paused until billing is current."
    : "Your 14-day trial has ended, so Zimer is paused until you subscribe.";
  const cta = failed || sub?.stripe_customer_id
    ? `<form method="POST" action="/billing/portal" style="margin:0">${button({ label: "Manage billing", variant: "primary", size: "lg", block: true, type: "submit" })}</form>`
    : `<form method="POST" action="/billing/checkout" style="margin:0">${button({ label: "Subscribe · $12/month", variant: "primary", size: "lg", block: true, type: "submit" })}</form>`;
  const content =
    logoLockup() +
    `<h1 class="ui-page-title" style="margin-top:var(--spacing-md)">${headline}</h1>` +
    `<p class="ui-app-sub">${copy}</p>` +
    `<p class="muted">Nothing is deleted — your time entries, clients, and zinvoices are saved and waiting.</p>` +
    cta +
    `<form method="POST" action="/logout" style="margin-top:var(--spacing-md)">${button({ label: "Log out", variant: "ghost", size: "sm", type: "submit" })}</form>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${headline} · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  </head>
  <body><main class="login">
  ${card({ content })}
  </main></body></html>`;
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
      /* #783: entitled users who land here directly go back to the app —
         the wall must never tell a paying user their trial ended. */
      if (viewer) {
        const createdMs = Date.parse(viewer.created_at);
        if (
          billing.billingActive(
            viewer.id,
            Number.isFinite(createdMs) ? createdMs : null
          )
        ) {
          return new Response(null, { status: 302, headers: { Location: "/" } });
        }
      }
      return html(billingWallPage(sub));
    }

    const user = accounts.sessionUserFromRequest(req);
    if (!user) return json({ error: "unauthorized" }, 401);

    if (path === "/billing/checkout" && method === "POST") {
      /* #912: checkout mints a Stripe session against the victim's account —
         a forged cross-site POST must not reach it. */
      if (!originMatches(req)) return json({ error: "cross-site request blocked" }, 403);
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
        /* #783: anchor the Stripe trial to the original signup window so
           checking out mid-trial doesn't stack a second free trial. When
           the window already elapsed, trial_end is omitted and the first
           charge happens today. Reuse the existing Stripe customer so one
           user never gets two. */
        const createdMs = Date.parse(user.created_at);
        const { url: checkoutUrl } = await createCheckoutSession({
          userId: user.id,
          email: user.email,
          origin: shareOrigin(req),
          trialEndMs: Number.isFinite(createdMs)
            ? createdMs + TRIAL_DAYS * 24 * 3600 * 1000
            : null,
          customerId: existing?.stripe_customer_id ?? null,
        });
        return Response.redirect(checkoutUrl, 303);
      } catch (err: any) {
        return json({ error: err?.message || "checkout failed" }, 502);
      }
    }

    if (path === "/billing/portal" && method === "POST") {
      /* #984: minting a portal session is a state change — POST + the #912
         origin check, never a bare link a cross-site page can trigger. */
      if (!originMatches(req)) return json({ error: "cross-site request blocked" }, 403);
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
