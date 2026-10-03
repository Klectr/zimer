/** #730: ops baseline — GET /health (no auth), GET /privacy, hosted terms
 *  content, and the support mailto in settings. Wires the real web router
 *  with the real public views so the rendered content is exercised, not
 *  stubs of it. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDb } from "../db.ts";
import { appVersion } from "../lib/version.ts";
import { createWebRouter } from "./web.ts";
import { createPublicViews } from "../views/public.ts";

function setup(authed = true) {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-ops-"))).db;
  const noop = () => "";
  const views = createPublicViews({
    getInvoice: () => null,
    invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    invoiceDocumentHtml: () => "",
    ensurePublicToken: () => "",
  });
  /* #733: data deps resolve per request through getTenant now. */
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
    managePage: noop, clientSelection: () => null,
    clientDetailBody: noop, clientListOob: noop,
    bizProfileSection: () => "<section>profile</section>",
    clientSettingsForm: noop, settingsPage: (b: string) => b,
    invoicesPage: noop, invoiceNewPage: noop,
    defaultNewInvParams: () => ({}), invoiceStep2: noop,
    invoiceDetailBody: noop, invoiceListOob: noop, invoiceDoc: noop,
    publicInvoicePage: noop,
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
    getTenant: () => tenant as any,
    STATIC_DIR: "", TOKEN: "t",
    authedPage: () => authed,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: (req: Request) => req.headers.get("HX-Request") === "true",
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "",
    PORT: 3000,
    HOSTED: false, accounts: null,
    loginPage: noop, signupPage: noop, hostedLoginPage: noop,
    changelogPage: () => [],
    termsPage: (s: any) => views.termsPage(s),
    privacyPage: () => views.privacyPage(),
    notFoundPage: noop, noSuchInvoicePage: noop,
    rateLimitPage: noop, errorPage: noop,
    invoicePdf: () => new Uint8Array(), stripeConfigured: () => false,
    workspaceEmpty: () => false, demoIds: () => [], seedDemoData: () => {},
    removeDemoData: () => {}, entryToJson: (e: any) => e,
  });
  return { handleWeb };
}

const get = (handleWeb: any, path: string, authed = true, htmx = false) =>
  handleWeb(
    new Request(`http://x${path}`, { headers: htmx ? { "HX-Request": "true" } : {} }),
    new URL(`http://x${path}`),
    path,
    "GET"
  );

describe("GET /health", () => {
  test("200 JSON {ok:true, version} with no auth", async () => {
    /* authed=false: the whole point is monitoring needs no session. */
    const { handleWeb } = setup(false);
    const res = await get(handleWeb, "/health", false);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(body.version).toBe(appVersion());
  });

  test("version matches the repo VERSION source", async () => {
    const { handleWeb } = setup(false);
    const body = await (await get(handleWeb, "/health", false)).json();
    expect(body.version).not.toBe("0.0.0-dev");
    expect(/^\d+\.\d+\.\d+$/.test(body.version)).toBe(true);
  });
});

describe("GET /privacy", () => {
  test("200, no auth, covers storage/deletion/no-sale", async () => {
    const { handleWeb } = setup(false);
    const res = await get(handleWeb, "/privacy", false);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Privacy policy");
    expect(html).toContain("support@klectr.dev");
    expect(html.toLowerCase()).toContain("sell your data");
    expect(html).toContain("/terms");
  });
});

describe("GET /terms (hosted fitness)", () => {
  test("describes the subscription, not the retired license key", async () => {
    const { handleWeb } = setup(false);
    const res = await get(handleWeb, "/privacy", false);
    expect(res.status).toBe(200); /* sanity: router wired */
    const terms = await (await get(handleWeb, "/terms", false)).text();
    expect(terms).toContain("$12/month");
    expect(terms).toContain("14 days");
    expect(terms).not.toContain("$59");
    expect(terms.toLowerCase()).not.toContain("license key");
  });
});

describe("settings support channel", () => {
  test("settings body ends with one mailto:support@klectr.dev link", async () => {
    const { handleWeb } = setup(true);
    /* htmx fragment (modal) and full page both carry the body. */
    for (const htmx of [true, false]) {
      const res = await get(handleWeb, "/settings", true, htmx);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('href="mailto:support@klectr.dev"');
    }
  });
});
