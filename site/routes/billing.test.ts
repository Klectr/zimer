/** #728: billing routes — Stripe API fully mocked; the webhook signature
 *  check runs the real verifier against a real HMAC. */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { createAccountsDb } from "../lib/accounts.ts";
import { createBillingRouter } from "./billing.ts";
import { verifyWebhookSignature } from "../stripe.ts";
import { json } from "../lib/http.ts";

const realFetch = globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};

let lastStripeCall: { url: string; body: string } | null = null;
let stripeResponses: Record<string, any> = {};

function mockFetch() {
  lastStripeCall = null;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    lastStripeCall = { url, body: String(init?.body || "") };
    for (const [path, data] of Object.entries(stripeResponses)) {
      if (url.endsWith(path)) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: { message: "not mocked" } }), {
      status: 500,
    });
  }) as typeof fetch;
}

function setup(hosted = true) {
  const accounts = createAccountsDb(mkdtempSync(join(tmpdir(), "tk-billrt-")));
  const { handleBilling, billing } = createBillingRouter({
    HOSTED: hosted,
    accounts,
    json,
    html: (body: string, status = 200) =>
      new Response(body, { status, headers: { "Content-Type": "text/html" } }),
    verifyWebhookSignature,
    shareOrigin: () => "http://localhost:3000",
  });
  return { accounts, handleBilling, billing };
}

function sign(payload: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

async function authedCookie(accounts: ReturnType<typeof createAccountsDb>) {
  const { user } = await accounts.signup("ada@example.com", "correct-horse-8");
  const token = accounts.createSession(user!.id);
  return { user: user!, cookie: `tksession=${token}` };
}

async function get(handleBilling: any, path: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost${path}`, { method: "GET", headers });
  return (await handleBilling(req, new URL(req.url), path, "GET"))!;
}

describe("#736: billing wall page + subscription gate", () => {
  const periodEnd = (daysFromNow: number) =>
    Math.floor(Date.now() / 1000) + daysFromNow * 86400;
  const subEventFor = (uid: number, status: string, endDays: number) => ({
    id: "e1",
    type: "customer.subscription.created",
    data: {
      object: {
        id: `sub_${status}`,
        customer: "cus_1",
        status,
        current_period_end: periodEnd(endDays),
        metadata: { user_id: String(uid) },
      },
    },
  });

  test("exact /billing renders (no auth gate) for an anonymous visitor", async () => {
    const { handleBilling } = setup();
    const res = await get(handleBilling, "/billing");
    expect(res).not.toBeNull();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Your trial ended");
    /* #783: no Stripe customer yet -> Subscribe posts to checkout, not the
       portal (the old portal link 409'd with no way to subscribe). */
    expect(body).toContain('action="/billing/checkout"');
    expect(body).toContain("Subscribe");
    expect(body).not.toContain('href="/billing/portal"');
    expect(body).toContain("md-filled-button");
  });

  test("past_due subscriber sees the payment-failed headline", async () => {
    const { accounts, handleBilling, billing } = setup();
    const { user, cookie } = await authedCookie(accounts);
    billing!.upsertFromStripeEvent(subEventFor(user.id, "past_due", -10));
    const res = await get(handleBilling, "/billing", cookie);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Payment failed");
    expect(body).toContain('href="/billing/portal"');
  });

  test("expired trial, no subscription row -> 'Your trial ended' + subscribe", async () => {
    const { accounts, handleBilling } = setup();
    const { user, cookie } = await authedCookie(accounts);
    accounts.db
      .query("UPDATE users SET created_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 20 * 86400000).toISOString(), user.id);
    const res = await get(handleBilling, "/billing", cookie);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Your trial ended");
    expect(body).toContain('action="/billing/checkout"');
  });

  test("trial-active user with no subscription row -> 302 to the app", async () => {
    const { accounts, handleBilling } = setup();
    const { cookie } = await authedCookie(accounts);
    const res = await get(handleBilling, "/billing", cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  test("entitled subscriber visiting /billing directly -> 302 to the app", async () => {
    const { accounts, handleBilling, billing } = setup();
    const { user, cookie } = await authedCookie(accounts);
    billing!.upsertFromStripeEvent(subEventFor(user.id, "active", 30));
    const res = await get(handleBilling, "/billing", cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  test("self-host mode: GET /billing -> 404", async () => {
    const { handleBilling } = setup(false);
    const res = await get(handleBilling, "/billing");
    expect(res.status).toBe(404);
  });

  test("createSubscriptionGate: active -> false, past-grace -> true", async () => {
    const { accounts, billing } = setup();
    const { user, cookie } = await authedCookie(accounts);
    const { createSubscriptionGate } = await import("./billing.ts");
    const { inactiveAuthedUser } = createSubscriptionGate({
      HOSTED: true, accounts, billing,
    });
    const authedReq = () =>
      new Request("http://localhost/", { headers: { cookie } });
    /* no row yet: inside the 14-day trial -> not gated */
    expect(inactiveAuthedUser(authedReq())).toBe(false);
    expect(inactiveAuthedUser(new Request("http://localhost/"))).toBe(false);
    /* past_due beyond grace -> gated */
    billing!.upsertFromStripeEvent(subEventFor(user.id, "past_due", -10));
    expect(inactiveAuthedUser(authedReq())).toBe(true);
    /* trialing again -> not gated */
    billing!.upsertFromStripeEvent(subEventFor(user.id, "trialing", 5));
    expect(inactiveAuthedUser(authedReq())).toBe(false);
  });

  test("createSubscriptionGate: self-host never gates", async () => {
    const { accounts, billing } = setup();
    const { cookie } = await authedCookie(accounts);
    const { createSubscriptionGate } = await import("./billing.ts");
    const { inactiveAuthedUser } = createSubscriptionGate({
      HOSTED: false, accounts, billing,
    });
    expect(
      inactiveAuthedUser(new Request("http://localhost/", { headers: { cookie } }))
    ).toBe(false);
  });

  test("portal stays reachable for an inactive (past-grace) subscriber", async () => {
    const { accounts, handleBilling, billing } = setup();
    const { user, cookie } = await authedCookie(accounts);
    billing!.upsertFromStripeEvent(subEventFor(user.id, "past_due", -10));
    const req = new Request("http://localhost/billing/portal", {
      method: "GET",
      headers: { cookie },
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/portal", "GET"))!;
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://billing.stripe.com/p/bps_1");
  });
});

beforeEach(() => {
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET"])
    savedEnv[k] = process.env[k];
  process.env.STRIPE_SECRET_KEY = "sk_test_728";
  process.env.STRIPE_PRICE_ID = "price_test_728";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_728";
  stripeResponses = {
    "/v1/checkout/sessions": { id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" },
    "/v1/billing_portal/sessions": { id: "bps_1", url: "https://billing.stripe.com/p/bps_1" },
  };
  mockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("#728: billing routes", () => {
  test("non-billing paths return null (fall through)", async () => {
    const { handleBilling } = setup();
    const req = new Request("http://localhost/timer", { method: "GET" });
    expect(await handleBilling(req, new URL(req.url), "/timer", "GET")).toBeNull();
  });

  test("self-host mode: billing routes 404", async () => {
    const { handleBilling } = setup(false);
    const req = new Request("http://localhost/billing/portal", { method: "GET" });
    const res = (await handleBilling(req, new URL(req.url), "/billing/portal", "GET"))!;
    expect(res.status).toBe(404);
  });

  test("checkout without a session -> 401", async () => {
    const { handleBilling } = setup();
    const req = new Request("http://localhost/billing/checkout", { method: "POST" });
    const res = (await handleBilling(req, new URL(req.url), "/billing/checkout", "POST"))!;
    expect(res.status).toBe(401);
  });

  test("checkout creates a subscription Checkout Session with the trial anchored to signup, then 303s", async () => {
    const { accounts, handleBilling } = setup();
    const { user, cookie } = await authedCookie(accounts);
    const createdMs = Date.parse(user.created_at);
    const req = new Request("http://localhost/billing/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/checkout", "POST"))!;
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://checkout.stripe.com/pay/cs_1");
    const params = new URLSearchParams(lastStripeCall!.body);
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][price]")).toBe("price_test_728");
    /* #783: one 14-day window from signup — trial_end, not a fresh
       trial_period_days that would stack a second free trial. */
    expect(params.get("trial_period_days")).toBeNull();
    const trialEnd = Number(params.get("trial_end"));
    const expected = Math.floor((createdMs + 14 * 86400000) / 1000);
    expect(Math.abs(trialEnd - expected)).toBeLessThan(120);
    expect(params.get("subscription_data[metadata][user_id]")).toBe(String(user.id));
    expect(params.get("client_reference_id")).toBe(String(user.id));
  });

  test("checkout after the trial window elapsed sends no trial (bills today)", async () => {
    const { accounts, handleBilling } = setup();
    const { user, cookie } = await authedCookie(accounts);
    accounts.db
      .query("UPDATE users SET created_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 20 * 86400000).toISOString(), user.id);
    const req = new Request("http://localhost/billing/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/checkout", "POST"))!;
    expect(res.status).toBe(303);
    const params = new URLSearchParams(lastStripeCall!.body);
    expect(params.get("trial_end")).toBeNull();
    expect(params.get("trial_period_days")).toBeNull();
  });

  test("checkout reuses the existing Stripe customer instead of customer_email", async () => {
    const { accounts, handleBilling, billing } = setup();
    const { user, cookie } = await authedCookie(accounts);
    billing!.upsertFromStripeEvent({
      id: "e1",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_old",
          customer: "cus_1",
          status: "canceled",
          current_period_end: Math.floor(Date.now() / 1000) - 86400,
          metadata: { user_id: String(user.id) },
        },
      },
    });
    const req = new Request("http://localhost/billing/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/checkout", "POST"))!;
    expect(res.status).toBe(303);
    const params = new URLSearchParams(lastStripeCall!.body);
    expect(params.get("customer")).toBe("cus_1");
    expect(params.get("customer_email")).toBeNull();
  });

  test("checkout for an already-subscribed user -> 409, no Stripe call", async () => {
    const { accounts, handleBilling, billing } = setup();
    const { user, cookie } = await authedCookie(accounts);
    billing!.upsertFromStripeEvent({
      id: "e1",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          metadata: { user_id: String(user.id) },
        },
      },
    });
    const req = new Request("http://localhost/billing/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/checkout", "POST"))!;
    expect(res.status).toBe(409);
    expect(lastStripeCall).toBeNull();
  });

  test("checkout without STRIPE_PRICE_ID -> 503", async () => {
    const { accounts, handleBilling } = setup();
    const { cookie } = await authedCookie(accounts);
    delete process.env.STRIPE_PRICE_ID;
    const req = new Request("http://localhost/billing/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/checkout", "POST"))!;
    expect(res.status).toBe(503);
  });

  test("portal without a customer -> 409", async () => {
    const { accounts, handleBilling } = setup();
    const { cookie } = await authedCookie(accounts);
    const req = new Request("http://localhost/billing/portal", {
      method: "GET",
      headers: { cookie },
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/portal", "GET"))!;
    expect(res.status).toBe(409);
  });

  test("portal with a customer -> 303 to the portal URL", async () => {
    const { accounts, handleBilling, billing } = setup();
    const { user, cookie } = await authedCookie(accounts);
    billing!.upsertFromStripeEvent({
      id: "e1",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "trialing",
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          metadata: { user_id: String(user.id) },
        },
      },
    });
    const req = new Request("http://localhost/billing/portal", {
      method: "GET",
      headers: { cookie },
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/portal", "GET"))!;
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://billing.stripe.com/p/bps_1");
    const params = new URLSearchParams(lastStripeCall!.body);
    expect(params.get("customer")).toBe("cus_1");
  });

  test("webhook with a bad signature -> 400, no DB writes", async () => {
    const { handleBilling, billing } = setup();
    const payload = JSON.stringify({ id: "e1", type: "charge.refunded", data: { object: {} } });
    const req = new Request("http://localhost/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: payload,
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/webhook", "POST"))!;
    expect(res.status).toBe(400);
    expect(billing!.getSubscriptionStatus(1)).toBeNull();
  });

  test("webhook with a real signature upserts the subscription row", async () => {
    const { accounts, handleBilling, billing } = setup();
    const { user } = await authedCookie(accounts);
    const payload = JSON.stringify({
      id: "evt_sub",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "trialing",
          trial_end: 1790000000,
          current_period_end: 1790000000,
          metadata: { user_id: String(user.id) },
        },
      },
    });
    const req = new Request("http://localhost/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": sign(payload, "whsec_test_728") },
      body: payload,
    });
    const res = (await handleBilling(req, new URL(req.url), "/billing/webhook", "POST"))!;
    expect(res.status).toBe(200);
    const row = billing!.getSubscriptionStatus(user.id)!;
    expect(row.stripe_subscription_id).toBe("sub_123");
    expect(row.stripe_customer_id).toBe("cus_123");
    expect(row.status).toBe("trialing");
    expect(row.trial_ends_at).toBe(new Date(1790000000 * 1000).toISOString());
  });
});
