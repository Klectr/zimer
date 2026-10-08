/** #783: hosted signup starts the Stripe trial — POST /signup 303s to
 *  Stripe Checkout (card up front, 14-day trial) when Stripe is configured,
 *  and falls back to the app when it isn't (or the call fails). */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import { createAccountsDb } from "../lib/accounts.ts";
import { createWebRouter } from "./web.ts";
import { createManageViews } from "../views/manage.ts";

const realFetch = globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};
let lastStripeCall: { url: string; body: string } | null = null;
let stripeOk = true;

function mockFetch() {
  lastStripeCall = null;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    lastStripeCall = { url, body: String(init?.body || "") };
    if (url.endsWith("/v1/checkout/sessions") && stripeOk) {
      return new Response(
        JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: { message: "boom" } }), {
      status: 500,
    });
  }) as typeof fetch;
}

function setup() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-signup-"))).db;
  const accounts = createAccountsDb(mkdtempSync(join(tmpdir(), "tk-signup-acct-")));
  const views = createManageViews({ db, layout: (_t: string, b: string) => b });
  const noop = () => "";
  const tenant = {
    db, dbPath: "",
    qRunning: { get: () => null } as any,
    qOne: { get: () => null } as any,
    qRange: { all: () => [] } as any,
    qInvoice: { get: () => null } as any,
    qInvoices: { all: () => [] } as any,
    notFoundPage: noop, errorPage: noop,
    dashboardPage: noop,
    timerPartial: noop, todayPartial: noop, weekInner: noop, weekStrip: noop,
    calendarPage: noop, editPage: () => null,
    managePage: views.managePage, clientSelection: views.clientSelection,
    clientDetailBody: views.clientDetailBody, clientListOob: views.clientListOob,
    bizProfileSection: noop, dailyTargetSection: views.dailyTargetSection, clientSettingsForm: views.clientSettingsForm, settingsPage: noop,
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
    getTenant: () => null as any,
    STATIC_DIR: "", TOKEN: "t",
    authedPage: () => false,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: (req: Request) => req.headers.get("HX-Request") === "true",
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "http://localhost:3000",
    PORT: 3000,
    loginPage: noop, signupPage: noop, hostedLoginPage: noop,
    HOSTED: true, accounts,
    changelogPage: () => [], termsPage: () => [],
    notFoundPage: noop, noSuchInvoicePage: noop,
    rateLimitPage: noop, errorPage: noop,
    invoicePdf: () => new Uint8Array(), stripeConfigured: () => false,
    workspaceEmpty: () => false, demoIds: () => [], seedDemoData: () => {},
    removeDemoData: () => {}, entryToJson: (e: any) => e,
  });
  return { accounts, handleWeb };
}

function signupPost(handleWeb: any, email: string, password: string) {
  const form = new FormData();
  form.append("email", email);
  form.append("password", password);
  const req = new Request("http://x/signup", { method: "POST", body: form });
  return handleWeb(req, new URL(req.url), "/signup", "POST");
}

beforeEach(() => {
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID"])
    savedEnv[k] = process.env[k];
  process.env.STRIPE_SECRET_KEY = "sk_test_783";
  process.env.STRIPE_PRICE_ID = "price_test_783";
  stripeOk = true;
  mockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("#791: signup starts the trial with no card", () => {
  test("signup -> 302 straight into the app, no Stripe call", async () => {
    const { accounts, handleWeb } = setup();
    const res = await signupPost(handleWeb, "ada@example.com", "correct-horse-8");
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe("/");
    expect(res!.headers.get("set-cookie")).toMatch(/tksession=/);
    expect(lastStripeCall).toBeNull();
    expect(accounts.db.query("SELECT id FROM users WHERE email = ?").get("ada@example.com")).toBeTruthy();
  });

  test("signup with no Stripe configured -> same 302, no Stripe call", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    const { handleWeb } = setup();
    const res = await signupPost(handleWeb, "grace@example.com", "correct-horse-8");
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe("/");
    expect(lastStripeCall).toBeNull();
  });

  test("invalid signup still 400s, no Stripe call", async () => {
    const { handleWeb } = setup();
    const res = await signupPost(handleWeb, "not-an-email", "correct-horse-8");
    expect(res!.status).toBe(400);
    expect(lastStripeCall).toBeNull();
  });
});
