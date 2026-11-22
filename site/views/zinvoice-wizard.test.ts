import { describe, expect, test } from "bun:test";
import { ZINVOICE_WIZARD_SCRIPT } from "./zinvoice-wizard.ts";

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
