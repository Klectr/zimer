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

  test("checkout creates a subscription Checkout Session with a 14-day trial, then 303s", async () => {
    const { accounts, handleBilling } = setup();
    const { user, cookie } = await authedCookie(accounts);
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
    expect(params.get("trial_period_days")).toBe("14");
    expect(params.get("subscription_data[metadata][user_id]")).toBe(String(user.id));
    expect(params.get("client_reference_id")).toBe(String(user.id));
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
