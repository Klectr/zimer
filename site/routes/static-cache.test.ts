import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebRouter } from "./web.ts";

const APP_JS = "console.log('ok');";
const APP_VERSION = createHash("sha256").update(APP_JS).digest("hex").slice(0, 12);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tk-static-cache-"));
  writeFileSync(join(dir, "app.js"), APP_JS);
  const noop = () => "";
  const tenant = { notFoundPage: () => "not-found", errorPage: () => "error" } as any;
  const { handleWeb } = createWebRouter({
    getTenant: () => tenant,
    STATIC_DIR: dir, TOKEN: "t",
    authedPage: () => false,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: () => false,
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "",
    PORT: 3000,
    loginPage: noop, signupPage: noop, hostedLoginPage: noop,
    HOSTED: false, accounts: null,
    changelogPage: () => "", termsPage: () => "", privacyPage: noop,
    noSuchInvoicePage: noop, rateLimitPage: noop,
    notFoundPage: () => "not-found", errorPage: () => "error",
    invoicePdf: () => new Uint8Array(), stripeConfigured: () => false,
    workspaceEmpty: () => false, demoIds: () => [], seedDemoData: () => {},
    removeDemoData: () => {}, entryToJson: (e: any) => e,
  } as any);
  return { handleWeb };
}

async function get(handleWeb: any, path: string) {
  const req = new Request(`http://x${path}`);
  return handleWeb(req, new URL(req.url), path.split("?")[0], "GET");
}

describe("static cache headers (#993)", () => {
  test("a current content-hash version is served immutable", async () => {
    const { handleWeb } = setup();
    const res = await get(handleWeb, `/static/app.js?v=${APP_VERSION}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  test("unversioned and stale-version requests revalidate", async () => {
    const { handleWeb } = setup();
    for (const path of ["/static/app.js", "/static/app.js?v=stale000000", "/static/app.js?v="]) {
      const res = await get(handleWeb, path);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("public, no-cache");
      expect(res.headers.get("ETag")).toBeTruthy();
    }
  });
});
