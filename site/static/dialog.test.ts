/** #456: focus trap for the modal dialogs (aria-modal="true").
 *
 *  dialog.js runs in the browser with real DOM; here it loads against tiny
 *  fakes so bun can exercise the Tab-cycling logic: wrap-around in both
 *  directions, focus pulled back in from outside, hidden/disabled elements
 *  skipped, and non-Tab keys ignored.
 */
import { afterEach, describe, expect, test } from "bun:test";

const g = globalThis as any;
g.window = {};

/* Tiny fake DOM element: just enough for dialog.js (explicit createElement
   construction, classList, attributes, children, listeners, focus). */
function fakeDomEl(tag = "div") {
  const el: any = {
    tagName: tag.toUpperCase(),
    className: "",
    id: "",
    textContent: "",
    type: "",
    disabled: false,
    dataset: {},
    children: [] as any[],
    parentNode: null,
    removed: false,
    focusCount: 0,
    clickCount: 0,
    _attrs: {} as Record<string, string>,
    _handlers: {} as Record<string, Function[]>,
    _rects: [{}],
    _class: new Set<string>(),
    getClientRects() { return this._rects; },
    setAttribute(k: string, v: string) { this._attrs[k] = v; },
    getAttribute(k: string) { return k in this._attrs ? this._attrs[k] : null; },
    appendChild(c: any) { this.children.push(c); c.parentNode = this; return c; },
    remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x: any) => x !== this); },
    addEventListener(t: string, h: Function) { (this._handlers[t] ||= []).push(h); },
    removeEventListener(t: string, h: Function) { this._handlers[t] = (this._handlers[t] || []).filter((x) => x !== h); },
    focus() { this.focusCount++; g.document.activeElement = this; },
    click() { this.clickCount++; },
    closest(_sel: string) { return null; },
    querySelectorAll(_sel: string) {
      const out: any[] = [];
      const walk = (n: any) => { for (const c of n.children) { if (["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(c.tagName)) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
  };
  el.classList = {
    add: (...cs: string[]) => cs.forEach((c) => el._class.add(c)),
    remove: (...cs: string[]) => cs.forEach((c) => el._class.delete(c)),
    contains: (c: string) => el._class.has(c),
  };
  return el;
}

const rafQueue: Function[] = [];
g.requestAnimationFrame = (fn: Function) => { rafQueue.push(fn); return rafQueue.length; };
function flushRaf() { while (rafQueue.length) (rafQueue.shift() as Function)(); }

g.document = {
  activeElement: null,
  _listeners: {} as Record<string, Function[]>,
  addEventListener(t: string, h: Function) { (this._listeners[t] ||= []).push(h); },
  removeEventListener(t: string, h: Function) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== h); },
  createElement: (tag: string) => fakeDomEl(tag),
  body: fakeDomEl("body"),
};

await import("./dialog.js");
const tkTrapTab = g.window.tkTrapTab as (container: any, e: any) => void;
const tkConfirm = g.window.tkConfirm as (message: string, confirmLabel?: string) => Promise<boolean>;

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

/** #464: shared M3 confirm dialog. The fake DOM above is just enough for the
 *  explicit createElement construction in dialog.js: structure is navigated
 *  through children, clicks through captured handlers, timers are real. */
function lastScrim() {
  const kids = g.document.body.children;
  return kids[kids.length - 1];
}
function dlgParts(scrim: any) {
  const box = scrim.children[0];
  const title = box.children[0];
  const actions = box.children[1];
  return { box, title, cancel: actions.children[1], ok: actions.children[2] };
}
const clickFirst = (el: any) => el._handlers.click[0]();

afterEach(async () => {
  /* settle any dialog a test left open so confirmOpen resets for the next */
  for (const scrim of [...g.document.body.children]) clickFirst(dlgParts(scrim).cancel);
  await new Promise((r) => setTimeout(r, 250));
});

describe("tkConfirm", () => {
  test("renders the message as headline and focuses Cancel", () => {
    tkConfirm("Delete this entry?");
    const scrim = lastScrim();
    expect(scrim.className).toBe("cal-scrim");
    const { box, title, cancel, ok } = dlgParts(scrim);
    expect(box.getAttribute("role")).toBe("alertdialog");
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(title.textContent).toBe("Delete this entry?");
    expect(cancel.textContent).toBe("Cancel");
    expect(ok.textContent).toBe("Delete");
    expect(g.document.activeElement).toBe(cancel);
  });

  test("enter transition adds .open on the next frames", () => {
    tkConfirm("Delete this entry?");
    const scrim = lastScrim();
    expect(scrim.classList.contains("open")).toBe(false);
    flushRaf();
    expect(scrim.classList.contains("open")).toBe(true);
  });

  test("OK resolves true and removes the dialog", async () => {
    const p = tkConfirm("Delete this entry?");
    clickFirst(dlgParts(lastScrim()).ok);
    expect(await p).toBe(true);
    expect(g.document.body.children.length).toBe(0);
  });

  test("Cancel resolves false and removes the dialog", async () => {
    const p = tkConfirm("Delete this entry?");
    clickFirst(dlgParts(lastScrim()).cancel);
    expect(await p).toBe(false);
    expect(g.document.body.children.length).toBe(0);
  });

  test("Escape resolves false and unregisters the key handler", async () => {
    const p = tkConfirm("Delete this entry?");
    const onKey = g.document._listeners["keydown"][0];
    const e: any = { key: "Escape", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    onKey(e);
    expect(e.defaultPrevented).toBe(true);
    expect(await p).toBe(false);
    expect((g.document._listeners["keydown"] || []).length).toBe(0);
  });

  test("scrim click cancels, clicking the dialog itself does nothing", async () => {
    let settled: boolean | null = null;
    const p = tkConfirm("Delete this entry?").then((v) => { settled = v; return v; });
    const scrim = lastScrim();
    scrim._handlers.click[0]({ target: scrim });
    expect(await p).toBe(false);
    expect(settled).toBe(false);

    /* reopen: a click whose target is the dialog box must not close it */
    settled = null;
    const p2 = tkConfirm("Delete this entry?").then((v) => { settled = v; return v; });
    const scrim2 = lastScrim();
    scrim2._handlers.click[0]({ target: dlgParts(scrim2).box });
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(null);
    expect(g.document.body.children.length).toBe(1);
    void p2;
  });

  test("message is set as text, never parsed as HTML", () => {
    tkConfirm("<img src=x onerror=alert(1)>");
    expect(dlgParts(lastScrim()).title.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  test("custom confirm label", () => {
    tkConfirm("Revoke the client link?", "Revoke");
    expect(dlgParts(lastScrim()).ok.textContent).toBe("Revoke");
  });

  test("second call while one is open resolves false without stacking", async () => {
    const p1 = tkConfirm("first");
    const p2 = tkConfirm("second");
    expect(await p2).toBe(false);
    expect(g.document.body.children.length).toBe(1);
    void p1;
  });

  test("Tab inside the dialog cycles through the dialog buttons", () => {
    tkConfirm("Delete this entry?");
    const { cancel, ok } = dlgParts(lastScrim());
    const onKey = g.document._listeners["keydown"][0];
    const before = cancel.focusCount;
    g.document.activeElement = ok;
    const e: any = { key: "Tab", shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    onKey(e);
    expect(e.defaultPrevented).toBe(true);
    expect(cancel.focusCount).toBe(before + 1);
  });
});

describe("data-confirm delegation", () => {
  function confirmButton(message: string, label: string | null = null) {
    const btn: any = fakeDomEl("button");
    btn._attrs = { "data-confirm": message };
    if (label) btn._attrs["data-confirm-label"] = label;
    btn.closest = (_sel: string) => btn;
    const realClick = btn.click.bind(btn);
    /* re-dispatched clicks travel back through the document capture listener */
    btn.click = () => {
      realClick();
      g.document._listeners["click"][0]({ target: btn, preventDefault() {}, stopPropagation() {} });
    };
    return btn;
  }
  function userClick(btn: any) {
    const e: any = {
      target: { closest: (_sel: string) => btn },
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    g.document._listeners["click"][0](e);
    return e;
  }
  const waitSettle = () => new Promise((r) => setTimeout(r, 300));

  test("click is intercepted, dialog shown, OK re-dispatches once", async () => {
    const btn = confirmButton("Delete this entry?");
    const e = userClick(btn);
    expect(e.defaultPrevented).toBe(true);
    expect(e.stopped).toBe(true);
    expect(btn.clickCount).toBe(0);
    expect(dlgParts(lastScrim()).title.textContent).toBe("Delete this entry?");
    clickFirst(dlgParts(lastScrim()).ok);
    await waitSettle();
    expect(btn.clickCount).toBe(1);
    expect("tkConfirmed" in btn.dataset).toBe(false); /* one-shot flag consumed */
    expect(g.document.body.children.length).toBe(0);
  });

  test("Cancel never re-dispatches the click", async () => {
    const btn = confirmButton("Delete this entry?");
    userClick(btn);
    clickFirst(dlgParts(lastScrim()).cancel);
    await waitSettle();
    expect(btn.clickCount).toBe(0);
  });

  test("custom label flows through data-confirm-label", async () => {
    const btn = confirmButton("Revoke the client link?", "Revoke");
    userClick(btn);
    expect(dlgParts(lastScrim()).ok.textContent).toBe("Revoke");
    clickFirst(dlgParts(lastScrim()).ok);
    await waitSettle();
    expect(btn.clickCount).toBe(1);
  });

  test("buttons without data-confirm are untouched", () => {
    const plain: any = fakeDomEl("button");
    plain.closest = () => null;
    const e: any = {
      target: { closest: () => null }, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    g.document._listeners["click"][0](e);
    expect(e.defaultPrevented).toBe(false);
    expect(e.stopped).toBe(false);
    expect(g.document.body.children.length).toBe(0);
  });
});
