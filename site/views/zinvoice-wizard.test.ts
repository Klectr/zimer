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

/* #1083: the new-Zinvoice form calculates from the selected client only.
   No DOM in the test runner (zero-dependency rule), so run the wizard
   script against a minimal stand-in of the elements it touches and drive
   the client <select>. */
describe("wizard follows the selected client (#1083)", () => {
  type Listener = (ev: any) => void;
  function fakeEl(props: Record<string, any> = {}) {
    const listeners: Record<string, Listener[]> = {};
    return Object.assign({
      dataset: {} as Record<string, string>, value: "", textContent: "", disabled: false, checked: true,
      addEventListener(t: string, f: Listener) { (listeners[t] ??= []).push(f); },
      fire(t: string, ev: any = {}) { for (const f of listeners[t] ?? []) f(ev); },
      querySelector: () => null, querySelectorAll: () => [], remove() { this.removed = true; },
      removed: false,
    }, props);
  }
  function run() {
    const clients = [
      { value: "", text: "Choose a client…", dataset: {} },
      { value: "1", text: "Acme", dataset: { rate: "40", termsDays: "30" } },
      { value: "2", text: "Northwind", dataset: { rate: "85" } }, /* pay when paid: no due date */
      { value: "3", text: "Bluefin", dataset: { rate: "0", termsDays: "15" } },
    ];
    const sel = fakeEl({ options: clients, selectedIndex: 0 });
    Object.defineProperty(sel, "value", { get: () => clients[sel.selectedIndex]!.value });
    const rate = fakeEl(), due = fakeEl(), issue = fakeEl({ value: "2026-11-24" });
    const timeRow = fakeEl({ querySelector: (q: string) => q.includes("_ids") ? { value: "7,8" } : null });
    const manualRow = fakeEl({ querySelector: (q: string) => q.includes("_ids") ? { value: "" } : null });
    const rows = [timeRow, manualRow];
    const form = fakeEl({ querySelectorAll: (q: string) => q.includes("tbody tr") ? rows.filter(r => !r.removed) : [] });
    const els: Record<string, any> = { "inv-client": sel, "inv-rate": rate, "inv-create-form": form, "inv-due": due, "inv-issue": issue };
    const ajax: string[] = [];
    const doc = { getElementById: (id: string) => els[id] ?? null, addEventListener() {}, body: fakeEl() };
    const win = { htmx: { ajax: (m: string, url: string) => { ajax.push(`${m} ${url}`); return Promise.resolve(); } } };
    const body = ZINVOICE_WIZARD_SCRIPT.replace(/^<script>/, "").replace(/<\/script>$/, "");
    new Function("document", "window", body)(doc, win);
    const pick = (i: number) => { sel.selectedIndex = i; sel.fire("change"); };
    return { pick, rate, due, rows, ajax };
  }

  test("switching clients replaces the rate instead of keeping the previous client's", () => {
    const { pick, rate } = run();
    pick(1); expect(rate.value).toBe("40");
    pick(2); expect(rate.value).toBe("85");
    pick(3); expect(rate.value).toBe(""); /* no rate: blank to fill, not Northwind's 85 */
  });

  test("the due date follows the client's terms and clears for pay-when-paid", () => {
    const { pick, due } = run();
    pick(1); expect(due.value).toBe("2026-12-24");
    pick(2); expect(due.value).toBe("");
    pick(3); expect(due.value).toBe("2026-12-09");
  });

  test("clearing the client drops its time lines, keeps manual lines, and loads nothing", () => {
    const { pick, rows, ajax } = run();
    pick(1);
    const before = ajax.length;
    pick(0);
    expect(rows[0]!.removed).toBe(true);
    expect(rows[1]!.removed).toBe(false);
    expect(ajax.length).toBe(before);
  });

  test("picking a client loads that client's range, then its preview", async () => {
    const { pick, ajax } = run();
    pick(2);
    await Promise.resolve();
    expect(ajax).toEqual(["GET /partial/invoice-rest?client_id=2", "POST /invoices/preview"]);
  });
});
