import { describe, expect, test } from "bun:test";
import { zinvoiceWizardStories } from "./zinvoice-wizard.stories";
import { ZINVOICE_WIZARD_SCRIPT } from "../site/ui/zinvoice-wizard";
import config from "../zandbox.config";

describe("zinvoice wizard stories", () => {
  test("cover the empty start, loaded lines and the no-time state", () => {
    const all = zinvoiceWizardStories.map((s) => s.render()).join("");
    expect(all).toContain('id="inv-client"');
    expect(all).toContain("Pick a client to load unbilled time");
    expect(all).toContain('name="g1_desc" value="Brand refresh"');
    expect(all).toContain("rounded up to 15-minute increments");
    expect(all).toContain("No unbilled time for Quill");
    expect(all).toContain("Live preview — INV-1047");
    expect(all).toMatch(/<button[^>]*disabled[^>]*>Save draft|Save draft[^<]*<\/button>/);
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of zinvoiceWizardStories) expect(ids).toContain(s.id);
  });
});

/* The script used to live in a TS template literal where "\B" and "\d" lost
   their backslash, shipping /B(?=(d{3})+(?!d))/ — no thousands separators
   in the live preview. Pin the real regex. */
describe("wizard script money format", () => {
  test("ships the thousands-separator regex intact and it formats correctly", () => {
    expect(ZINVOICE_WIZARD_SCRIPT).toContain("/\\B(?=(\\d{3})+(?!\\d))/g");
    const fmt = (n: number) => "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    expect(fmt(1234567.5)).toBe("$1,234,567.50");
  });
});
