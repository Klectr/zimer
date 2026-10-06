/** #827: the auth pages' floating labels are wired to their fields via
 *  matching id/for, completing the label-wiring pass (#709 pattern). */
import { describe, expect, test } from "bun:test";
import { createPublicViews } from "./public.ts";

const views = createPublicViews({
  getInvoice: () => null,
  invoiceTotals: () => ({}),
  invoiceDocumentHtml: () => "",
  ensurePublicToken: () => "",
} as any);

describe("auth labels (#827)", () => {
  test("token login label is wired", () => {
    const html = views.loginPage();
    expect(html).toContain('id="login-token"');
    expect(html).toContain('<label for="login-token">');
  });

  test("signup labels are wired", () => {
    const html = views.signupPage();
    for (const id of ["su-email", "su-password"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
  });

  test("hosted login labels are wired", () => {
    const html = views.hostedLoginPage();
    for (const id of ["li-email", "li-password"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
  });
});
