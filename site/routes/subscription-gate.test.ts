/** #736: hosted subscription gating — pages 302 to /billing and the API
 *  403s for authed users past entitlement; self-host never gates. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Statement } from "bun:sqlite";
import { createAccountsDb } from "../lib/accounts.ts";
import { createBilling } from "../lib/billing.ts";
import { createSubscriptionGate } from "./billing.ts";
import { createWebRouter } from "./web.ts";
import { createApiRouter } from "./api.ts";

const DAY = 86400000;
const stubStatement = () =>
  ({ get: () => null, all: () => [], run: () => {} } as unknown as Statement);

async function hostedAccounts() {
  const accounts = createAccountsDb(mkdtempSync(join(tmpdir(), "tk-gate-")));
  const billing = createBilling(accounts);
  const { inactiveAuthedUser } = createSubscriptionGate({
    HOSTED: true, accounts, billing,
  });
  return { accounts, billing, inactiveAuthedUser };
}

async function signup(accounts: ReturnType<typeof createAccountsDb>) {
  const { user } = await accounts.signup("ada@example.com", "correct-horse-8");
  const token = accounts.createSession(user!.id);
  return { user: user!, cookie: `tksession=${token}` };
}

function backdate(accounts: ReturnType<typeof createAccountsDb>, id: number, days: number) {
  accounts.db
    .query("UPDATE users SET created_at = ? WHERE id = ?")
    .run(new Date(Date.now() - days * DAY).toISOString(), id);
}

function webSetup(accounts: ReturnType<typeof createAccountsDb>, gate: any, hosted: boolean) {
  const noop = () => "";
  const tenant = {
    db: null, dbPath: "",
    qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
    qInvoice: stubStatement(), qInvoices: stubStatement(),
    notFoundPage: noop, errorPage: noop,
    dashboardPage: () => "DASHBOARD",
    timerPartial: noop, todayPartial: noop, weekInner: noop, weekStrip: noop,
    calendarPage: noop, editPage: () => null,
    managePage: noop, clientSelection: () => null, clientDetailBody: noop, clientListOob: noop,
    bizProfileSection: noop, clientSettingsForm: noop, settingsPage: noop,
    invoicesPage: noop, invoiceNewPage: noop,
    defaultNewInvParams: () => ({}), invoiceStep2: noop,
    invoiceDetailBody: noop, invoiceListOob: noop, invoiceDoc: noop, publicInvoicePage: noop,
    getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    stripeLinkFor: async () => ({}),
    unbilledEntries: () => [], groupToLineItems: () => [],
    clientRestFrom: () => null, ensurePublicToken: () => "",
    getPublicToken: () => null, mintPublicToken: () => "",
    invoicePdfInput: () => ({} as any),
    freezeInvoiceSnapshots: () => {},
  };
  const { handleWeb } = createWebRouter({
    getTenant: hosted
      ? ((req: Request) => (accounts.sessionUserFromRequest(req) ? (tenant as any) : null))
      : (() => tenant as any),
    STATIC_DIR: "", TOKEN: "t",
    authedPage: () => true,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: () => false,
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "",
    PORT: 3000,
    loginPage: noop, signupPage: noop, hostedLoginPage: () => "HOSTED-LOGIN",
    HOSTED: hosted, accounts: hosted ? accounts : null,
    changelogPage: () => "CHANGELOG", termsPage: () => "TERMS", privacyPage: () => "PRIVACY",
    notFoundPage: noop, noSuchInvoicePage: noop,
    rateLimitPage: () => "RATE-LIMITED", errorPage: noop,
    invoicePdf: () => new Uint8Array(), stripeConfigured: () => false,
    workspaceEmpty: () => false, demoIds: () => [], seedDemoData: () => {},
    removeDemoData: () => {}, entryToJson: (e: any) => e,
    inactiveAuthedUser: gate,
  });
  return { handleWeb };
}

async function webGet(handleWeb: any, path: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://x${path}`, { headers });
  return (await handleWeb(req, new URL(req.url), path, "GET"))!;
}

/* #912: POST helper for the CSRF-guard era — no Origin header, which the
   guard treats as allowed (same as curl and the existing test clients). */
async function webPost(handleWeb: any, path: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://x${path}`, { method: "POST", headers });
  return (await handleWeb(req, new URL(req.url), path, "POST"))!;
}

function apiSetup(accounts: ReturnType<typeof createAccountsDb>, gate: any) {
  const tenant = {
    db: null,
    qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
    qInvoice: stubStatement(), qInvoices: stubStatement(),
    groupToLineItems: () => [], unbilledEntries: () => [],
    getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    mintPublicToken: () => "", stripeLinkFor: async () => ({}),
    revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
    revenueOverdue: () => [], freezeInvoiceSnapshots: () => {},
  };
  const { handleApi } = createApiRouter({
    getTenant: (req: Request) =>
      accounts.sessionUserFromRequest(req) ? (tenant as any) : null,
    TOKEN: "t",
    authedApi: (req: Request) => accounts.sessionUserFromRequest(req) !== null,
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    entryToJson: (e: any) => e,
    verifyWebhookSignature: () => false,
    shareOrigin: () => "",
    inactiveAuthedUser: gate,
  });
  return { handleApi };
}

async function apiGet(handleApi: any, path: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://x${path}`, { headers });
  return (await handleApi(req, new URL(req.url), path, "GET"))!;
}

describe("#736: page gating", () => {
  test("active user (fresh trial, no row) reaches pages", async () => {
    const { accounts, inactiveAuthedUser } = await hostedAccounts();
    const { user, cookie } = await signup(accounts);
    void user;
    const { handleWeb } = webSetup(accounts, inactiveAuthedUser, true);
    const res = await webGet(handleWeb, "/", cookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("DASHBOARD");
  });

  test("past-trial, no-row user 302s to /billing on gated pages", async () => {
    const { accounts, inactiveAuthedUser } = await hostedAccounts();
    const { user, cookie } = await signup(accounts);
    backdate(accounts, user.id, 20);
    const { handleWeb } = webSetup(accounts, inactiveAuthedUser, true);
    for (const p of ["/", "/calendar", "/manage", "/invoices", "/partial/timer"]) {
      const res = await webGet(handleWeb, p, cookie);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/billing");
    }
  });

  test("allowlisted surface stays reachable while gated", async () => {
    const { accounts, inactiveAuthedUser } = await hostedAccounts();
    const { user, cookie } = await signup(accounts);
    backdate(accounts, user.id, 20);
    const { handleWeb } = webSetup(accounts, inactiveAuthedUser, true);
    /* pre-auth paths run before the gate — none 302 to /billing */
    expect((await webGet(handleWeb, "/health", cookie)).status).toBe(200);
    expect((await webGet(handleWeb, "/terms", cookie)).status).toBe(200);
    expect((await webGet(handleWeb, "/privacy", cookie)).status).toBe(200);
    expect((await webGet(handleWeb, "/changelog", cookie)).status).toBe(200);
    /* #912: logout is POST-only now — the POST must still work while gated. */
    const logout = await webPost(handleWeb, "/logout", cookie);
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/login");
  });

  test("unauthenticated visitors still 302 to /login, not /billing", async () => {
    const { accounts, inactiveAuthedUser } = await hostedAccounts();
    const { handleWeb } = webSetup(accounts, inactiveAuthedUser, true);
    const res = await webGet(handleWeb, "/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  test("self-host mode: no gating at all", async () => {
    const { accounts } = await hostedAccounts();
    const { handleWeb } = webSetup(accounts, undefined, false);
    const res = await webGet(handleWeb, "/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("DASHBOARD");
  });

  test("past-due within grace -> 200; past grace -> 302 /billing", async () => {
    const { accounts, billing, inactiveAuthedUser } = await hostedAccounts();
    const { user, cookie } = await signup(accounts);
    const subEvent = (status: string, endDays: number) => ({
      id: "e1",
      type: "customer.subscription.created",
      data: {
        object: {
          id: `sub_${status}`, customer: "cus_1", status,
          current_period_end: Math.floor(Date.now() / 1000) + endDays * 86400,
          metadata: { user_id: String(user.id) },
        },
      },
    });
    const { handleWeb } = webSetup(accounts, inactiveAuthedUser, true);
    billing.upsertFromStripeEvent(subEvent("past_due", -3));
    expect((await webGet(handleWeb, "/", cookie)).status).toBe(200);
    billing.upsertFromStripeEvent(subEvent("past_due", -10));
    const res = await webGet(handleWeb, "/", cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/billing");
  });
});

describe("#736: API gating", () => {
  test("unauthenticated -> 401, not 403", async () => {
    const { accounts, inactiveAuthedUser } = await hostedAccounts();
    const { handleApi } = apiSetup(accounts, inactiveAuthedUser);
    const res = await apiGet(handleApi, "/api/status");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("authed active user -> 200", async () => {
    const { accounts, inactiveAuthedUser } = await hostedAccounts();
    const { cookie } = await signup(accounts);
    const { handleApi } = apiSetup(accounts, inactiveAuthedUser);
    const res = await apiGet(handleApi, "/api/status", cookie);
    expect(res.status).toBe(200);
  });

  test("authed past-grace user -> 403 subscription_inactive", async () => {
    const { accounts, inactiveAuthedUser } = await hostedAccounts();
    const { user, cookie } = await signup(accounts);
    backdate(accounts, user.id, 20);
    const { handleApi } = apiSetup(accounts, inactiveAuthedUser);
    const res = await apiGet(handleApi, "/api/status", cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "subscription_inactive" });
  });

  test("past-due within grace -> 200 on the API", async () => {
    const { accounts, billing, inactiveAuthedUser } = await hostedAccounts();
    const { user, cookie } = await signup(accounts);
    billing.upsertFromStripeEvent({
      id: "e1",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_pd", customer: "cus_1", status: "past_due",
          current_period_end: Math.floor(Date.now() / 1000) - 3 * 86400,
          metadata: { user_id: String(user.id) },
        },
      },
    });
    const { handleApi } = apiSetup(accounts, inactiveAuthedUser);
    expect((await apiGet(handleApi, "/api/status", cookie)).status).toBe(200);
  });
});
