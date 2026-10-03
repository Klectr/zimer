/** #728: hosted subscription billing — status, grace periods, webhook upserts. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountsDb } from "./accounts.ts";
import { createBilling, TRIAL_DAYS, PAST_DUE_GRACE_DAYS } from "./billing.ts";

function mkBilling() {
  const accounts = createAccountsDb(mkdtempSync(join(tmpdir(), "tk-bill-")));
  return { accounts, billing: createBilling(accounts) };
}

async function userId(accounts: ReturnType<typeof createAccountsDb>) {
  const { user } = await accounts.signup("ada@example.com", "correct-horse-8");
  return user!.id;
}

const subEvent = (userId: number, overrides: any = {}) => ({
  id: "evt_sub",
  type: "customer.subscription.created",
  data: {
    object: {
      id: "sub_123",
      customer: "cus_123",
      status: "trialing",
      trial_end: Math.floor(Date.now() / 1000) + TRIAL_DAYS * 86400,
      current_period_end: Math.floor(Date.now() / 1000) + TRIAL_DAYS * 86400,
      metadata: { user_id: String(userId) },
      ...overrides,
    },
  },
});

describe("#728: subscription status and grace periods", () => {
  test("no row -> inactive", async () => {
    const { accounts, billing } = mkBilling();
    expect(billing.getSubscriptionStatus(await userId(accounts))).toBeNull();
    expect(billing.subscriptionActive(1)).toBe(false);
  });

  test("trialing and active -> active", async () => {
    const { accounts, billing } = mkBilling();
    const uid = await userId(accounts);
    billing.upsertFromStripeEvent(subEvent(uid));
    expect(billing.subscriptionActive(uid)).toBe(true);
    billing.upsertFromStripeEvent({
      id: "evt_2",
      type: "customer.subscription.updated",
      data: {
        object: { ...subEvent(uid).data.object, id: "sub_123", status: "active" },
      },
    });
    expect(billing.subscriptionActive(uid)).toBe(true);
  });

  test("past_due -> 7-day grace, then blocked", async () => {
    const { accounts, billing } = mkBilling();
    const uid = await userId(accounts);
    const periodEnd = Math.floor(Date.now() / 1000) - 3 * 86400; /* 3 days ago */
    billing.upsertFromStripeEvent(
      subEvent(uid, { status: "past_due", current_period_end: periodEnd })
    );
    expect(billing.subscriptionActive(uid)).toBe(true);
    expect(
      billing.subscriptionActive(uid, new Date(Date.now() + 5 * 86400000))
    ).toBe(false);
    expect(PAST_DUE_GRACE_DAYS).toBe(7);
  });

  test("canceled stays active until period end (cancel-at-end)", async () => {
    const { accounts, billing } = mkBilling();
    const uid = await userId(accounts);
    const periodEnd = Math.floor(Date.now() / 1000) + 10 * 86400;
    billing.upsertFromStripeEvent({
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "canceled",
          current_period_end: periodEnd,
          metadata: { user_id: String(uid) },
        },
      },
    });
    const s = billing.getSubscriptionStatus(uid)!;
    expect(s.status).toBe("canceled");
    expect(billing.subscriptionActive(uid)).toBe(true);
    expect(
      billing.subscriptionActive(uid, new Date(Date.now() + 11 * 86400000))
    ).toBe(false);
  });

  test("invoice.payment_failed flips a known subscription to past_due", async () => {
    const { accounts, billing } = mkBilling();
    const uid = await userId(accounts);
    billing.upsertFromStripeEvent(subEvent(uid));
    expect(billing.subscriptionActive(uid)).toBe(true);
    billing.upsertFromStripeEvent({
      id: "evt_inv",
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", subscription: "sub_123" } },
    });
    expect(billing.getSubscriptionStatus(uid)!.status).toBe("past_due");
  });

  test("trial_will_end is acknowledged with no DB change", async () => {
    const { accounts, billing } = mkBilling();
    const uid = await userId(accounts);
    billing.upsertFromStripeEvent(subEvent(uid));
    const before = billing.getSubscriptionStatus(uid)!;
    expect(
      billing.upsertFromStripeEvent({
        id: "evt_twe",
        type: "customer.subscription.trial_will_end",
        data: { object: { id: "sub_123" } },
      })
    ).toBe(true);
    expect(billing.getSubscriptionStatus(uid)).toEqual(before);
    expect(billing.subscriptionActive(uid)).toBe(true);
  });

  test("subscription events without metadata fall back to subscription id lookup", async () => {
    const { accounts, billing } = mkBilling();
    const uid = await userId(accounts);
    billing.upsertFromStripeEvent(subEvent(uid));
    const handled = billing.upsertFromStripeEvent({
      id: "evt_3",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "past_due",
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          metadata: {},
        },
      },
    });
    expect(handled).toBe(true);
    expect(billing.getSubscriptionStatus(uid)!.status).toBe("past_due");
  });

  test("unattributable subscription events are handled without a row", async () => {
    const { accounts, billing } = mkBilling();
    await userId(accounts);
    const handled = billing.upsertFromStripeEvent({
      id: "evt_orphan",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_zzz",
          customer: "cus_zzz",
          status: "active",
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          metadata: {},
        },
      },
    });
    expect(handled).toBe(true);
    expect(billing.getSubscriptionStatus(9999)).toBeNull();
  });

  test("unknown event types return false", () => {
    const { billing } = mkBilling();
    expect(
      billing.upsertFromStripeEvent({ type: "charge.refunded", data: { object: {} } })
    ).toBe(false);
  });
});

describe("#736: billingActive — gate entitlement incl. pre-checkout trial", () => {
  const DAY = 86400000;
  const daysAgoMs = (d: number) => Date.now() - d * DAY;
  const subEventFor = (uid: number, status: string, endDays: number) => ({
    id: "e1",
    type: "customer.subscription.created",
    data: {
      object: {
        id: `sub_${status}`,
        customer: "cus_1",
        status,
        current_period_end: Math.floor(Date.now() / 1000) + endDays * 86400,
        metadata: { user_id: String(uid) },
      },
    },
  });

  test("row statuses follow subscriptionActive (active, past-due grace, expired)", async () => {
    const { accounts, billing } = mkBilling();
    const uid = await userId(accounts);
    const created = daysAgoMs(100);
    billing.upsertFromStripeEvent(subEventFor(uid, "active", 5));
    expect(billing.billingActive(uid, created)).toBe(true);
    billing.upsertFromStripeEvent(subEventFor(uid, "past_due", -3));
    expect(billing.billingActive(uid, created)).toBe(true); /* within grace */
    billing.upsertFromStripeEvent(subEventFor(uid, "past_due", -10));
    expect(billing.billingActive(uid, created)).toBe(false); /* past grace */
    billing.upsertFromStripeEvent(subEventFor(uid, "canceled", 5));
    expect(billing.billingActive(uid, created)).toBe(true); /* cancel-at-end */
    billing.upsertFromStripeEvent(subEventFor(uid, "canceled", -1));
    expect(billing.billingActive(uid, created)).toBe(false);
  });

  test("inactive row grants nothing even inside the signup trial window", async () => {
    const { accounts, billing } = mkBilling();
    const uid = await userId(accounts);
    billing.upsertFromStripeEvent(subEventFor(uid, "unpaid", 5));
    expect(billing.billingActive(uid, daysAgoMs(2))).toBe(false);
  });

  test("no row: trialing for 14 days from signup, then inactive", async () => {
    const { billing } = mkBilling();
    const uid = 4242; /* never checked out — no row */
    expect(billing.billingActive(uid, daysAgoMs(5))).toBe(true);
    expect(billing.billingActive(uid, daysAgoMs(13))).toBe(true);
    expect(billing.billingActive(uid, daysAgoMs(15))).toBe(false);
    expect(billing.billingActive(uid, daysAgoMs(100))).toBe(false);
  });

  test("no row and no created_at -> inactive", async () => {
    const { billing } = mkBilling();
    expect(billing.billingActive(4242, null)).toBe(false);
    expect(billing.billingActive(4242, NaN)).toBe(false);
  });
});
