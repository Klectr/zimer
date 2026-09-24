/** #456: focus trap for the modal dialogs (aria-modal="true").
 *
 *  dialog.js runs in the browser with real DOM; here it loads against tiny
 *  fakes so bun can exercise the Tab-cycling logic: wrap-around in both
 *  directions, focus pulled back in from outside, hidden/disabled elements
 *  skipped, and non-Tab keys ignored.
 */
import { describe, expect, test } from "bun:test";

const g = globalThis as any;
g.window = {};
g.document = { activeElement: null };

await import("./dialog.js");
const tkTrapTab = g.window.tkTrapTab as (container: any, e: any) => void;

function fakeEl(opts: { visible?: boolean; disabled?: boolean } = {}) {
  const el: any = {
    disabled: opts.disabled ?? false,
    _rects: (opts.visible ?? true) ? [{}] : [],
    getClientRects() { return this._rects; },
    focusCount: 0,
    focus() { this.focusCount++; g.document.activeElement = this; },
  };
  return el;
}
function fakeEvent(key: string, shiftKey = false) {
  const e: any = {
    key, shiftKey, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  return e;
}
function fakeContainer(els: any[]) {
  return {
    querySelectorAll: () => els,
    contains: (el: any) => els.includes(el),
  };
}
function setup(els: any[]) {
  const c = fakeContainer(els);
  g.document.activeElement = null;
  return c;
}

describe("tkTrapTab", () => {
  test("Tab on the last element wraps to the first", () => {
    const [a, b] = [fakeEl(), fakeEl()];
    const c = setup([a, b]);
    g.document.activeElement = b;
    const e = fakeEvent("Tab");
    tkTrapTab(c, e);
    expect(e.defaultPrevented).toBe(true);
    expect(a.focusCount).toBe(1);
    expect(b.focusCount).toBe(0);
  });

  test("Shift+Tab on the first element wraps to the last", () => {
    const [a, b] = [fakeEl(), fakeEl()];
    const c = setup([a, b]);
    g.document.activeElement = a;
    const e = fakeEvent("Tab", true);
    tkTrapTab(c, e);
    expect(e.defaultPrevented).toBe(true);
    expect(b.focusCount).toBe(1);
    expect(a.focusCount).toBe(0);
  });

  test("Tab on a middle element does nothing", () => {
    const [a, b, z] = [fakeEl(), fakeEl(), fakeEl()];
    const c = setup([a, b, z]);
    g.document.activeElement = b;
    const e = fakeEvent("Tab");
    tkTrapTab(c, e);
    expect(e.defaultPrevented).toBe(false);
    expect(a.focusCount + b.focusCount + z.focusCount).toBe(0);
  });

  test("Tab with focus outside the dialog pulls it back to the first", () => {
    const [a, b] = [fakeEl(), fakeEl()];
    const c = setup([a, b]);
    g.document.activeElement = fakeEl(); /* e.g. body, behind the scrim */
    const e = fakeEvent("Tab");
    tkTrapTab(c, e);
    expect(e.defaultPrevented).toBe(true);
    expect(a.focusCount).toBe(1);
  });

  test("Shift+Tab with focus outside pulls it back to the last", () => {
    const [a, b] = [fakeEl(), fakeEl()];
    const c = setup([a, b]);
    g.document.activeElement = fakeEl();
    const e = fakeEvent("Tab", true);
    tkTrapTab(c, e);
    expect(e.defaultPrevented).toBe(true);
    expect(b.focusCount).toBe(1);
  });

  test("hidden and disabled elements are skipped", () => {
    const [hidden, disabled, a, b] = [fakeEl({ visible: false }), fakeEl({ disabled: true }), fakeEl(), fakeEl()];
    const c = setup([hidden, disabled, a, b]);
    g.document.activeElement = b;
    const e = fakeEvent("Tab");
    tkTrapTab(c, e);
    expect(e.defaultPrevented).toBe(true);
    expect(a.focusCount).toBe(1); /* wraps past hidden/disabled straight to a */
    expect(hidden.focusCount).toBe(0);
    expect(disabled.focusCount).toBe(0);
  });

  test("empty dialog prevents default instead of throwing", () => {
    const c = setup([]);
    const e = fakeEvent("Tab");
    expect(() => tkTrapTab(c, e)).not.toThrow();
    expect(e.defaultPrevented).toBe(true);
  });

  test("non-Tab keys are ignored", () => {
    const [a] = [fakeEl()];
    const c = setup([a]);
    g.document.activeElement = a;
    const e = fakeEvent("Escape");
    tkTrapTab(c, e);
    expect(e.defaultPrevented).toBe(false);
    expect(a.focusCount).toBe(0);
  });
});
