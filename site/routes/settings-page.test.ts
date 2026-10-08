/** #693: direct (non-htmx) GET /settings renders the full app layout.
 * The settings modal body fragment alone is unstyled when visited directly. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDb } from "../db.ts";
import { createWebRouter } from "./web.ts";
import { createManageViews } from "../views/manage.ts";

function setup() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-settings-"))).db;
  /* Mark the layout so the test can tell the bare fragment from the full page. */
  const views = createManageViews({ db, layout: (t: string, b: string) => `<!DOCTYPE html><title>${t}</title>${b}` });
  const noop = () => "";
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
    managePage: views.managePage, clientSelection: views.clientSelection,
    clientDetailBody: views.clientDetailBody, clientListOob: views.clientListOob,
    bizProfileSection: views.bizProfileSection, dailyTargetSection: views.dailyTargetSection, clientSettingsForm: views.clientSettingsForm,
    settingsPage: views.settingsPage, invoicesPage: noop, invoiceNewPage: noop,
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
    getTenant: () => tenant as any,
    STATIC_DIR: "", TOKEN: "t",
    authedPage: () => true,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: (req: Request) => req.headers.get("HX-Request") === "true",
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "",
    PORT: 3000,
    loginPage: noop, signupPage: noop, hostedLoginPage: noop,
    HOSTED: false, accounts: null,
    changelogPage: () => [], termsPage: () => [],
    notFoundPage: noop, noSuchInvoicePage: noop,
    rateLimitPage: noop, errorPage: noop,
    invoicePdf: () => new Uint8Array(), stripeConfigured: () => false,
    workspaceEmpty: () => false, demoIds: () => [], seedDemoData: () => {},
    removeDemoData: () => {}, entryToJson: (e: any) => e,
  });
  return { handleWeb };
}

function getSettings(handleWeb: any, htmx: boolean) {
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request("http://x/settings", { headers });
  return handleWeb(req, new URL(req.url), "/settings", "GET");
}

describe("settings page (#693)", () => {
  test("htmx request gets the bare modal fragment", async () => {
    const { handleWeb } = setup();
    const res = await getSettings(handleWeb, true);
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('id="biz-profile"');
    expect(body).not.toContain("<!DOCTYPE html>");
  });

  test("direct visit gets the full app layout", async () => {
    const { handleWeb } = setup();
    const res = await getSettings(handleWeb, false);
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("<title>Settings</title>");
    expect(body).toContain('class="settings-sections"');
    expect(body).toContain('id="biz-profile"');
  });
});
