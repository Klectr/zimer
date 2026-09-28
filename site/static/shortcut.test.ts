/** #496: site-wide 450ms long-press reveals M3 plain tooltips on touch.
 *
 *  shortcut.js runs in the browser with real DOM; here it loads against tiny
 *  fakes so bun can exercise the long-press logic: tip-show is added after
 *  450ms on a [data-tip] target, cleared on pointerup/pointercancel, nothing
 *  is scheduled for non-tip targets, and releasing early cancels the timer.
 *
 *  #534: the same fakes also cover the t-shortcut toggle guard — key
 *  auto-repeat is ignored, and a second press while a toggle request is in
 *  flight fires no second request.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const g = globalThis as any;
g.window = {};

function fakeTipEl() {
  const el: any = {
    _class: new Set<string>(),
    classList: {
      add: (...cs: string[]) => cs.forEach((c) => el._class.add(c)),
      remove: (...cs: string[]) => cs.forEach((c) => el._class.delete(c)),
      contains: (c: string) => el._class.has(c),
    },
    /* Matches only the selector the wiring queries for. */
    closest: (sel: string) => (sel === "[data-tip]" ? el : null),
  };
  return el;
}
function fakePlainEl() {
  return { closest: (_sel: string) => null };
}

/* Fake timers: capture setTimeout callbacks so the 450ms delay is driven manually. */
let nextTimerId = 1;
const timers = new Map<number, { cb: Function; ms: number; cleared: boolean }>();
g.setTimeout = (cb: Function, ms: number) => {
  const id = nextTimerId++;
  timers.set(id, { cb, ms, cleared: false });
  return id;
};
g.clearTimeout = (id: number) => {
  const t = timers.get(id);
  if (t) t.cleared = true;
};
function fireTimers() {
  const due = [...timers.values()];
  timers.clear();
  for (const t of due) if (!t.cleared) t.cb();
}

function fakeDiv() {
  const el: any = { _class: new Set<string>(), textContent: "" };
  el.classList = {
    add: (...cs: string[]) => cs.forEach((c) => el._class.add(c)),
    remove: (...cs: string[]) => cs.forEach((c) => el._class.delete(c)),
  };
  el.setAttribute = (_k: string, _v: string) => {};
  return el;
}

g.document = {
  title: "Timekeep",
  body: { dataset: {}, appendChild: (_el: any) => {} },
  createElement: (_tag: string) => fakeDiv(),
  _listeners: {} as Record<string, Function[]>,
  addEventListener(t: string, h: Function) {
    (this._listeners[t] ||= []).push(h);
  },
  getElementById: () => null,
  /* #538: overridable per test — returns the timer card's start form or null. */
  querySelector: (_sel: string) => null,
};

await import("./shortcut.js");

/* shortcut.js registers exactly one document pointerdown/pointerup/pointercancel
   listener — the long-press wiring (keydown and htmx:afterRequest are separate). */
function on(type: string) {
  const hs = (g.document._listeners[type] || []) as Function[];
  if (hs.length !== 1)
    throw new Error(`expected exactly one ${type} listener, got ${hs.length}`);
  return hs[0] as (e: any) => void;
}
const down = on("pointerdown");
const up = on("pointerup");
const cancel = on("pointercancel");

beforeEach(() => {
  timers.clear();
});

describe("long-press tooltips", () => {
  test("tip-show appears after 450ms on a [data-tip] target", () => {
    const el = fakeTipEl();
    down({ target: el });
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].ms).toBe(450);
    expect(el.classList.contains("tip-show")).toBe(false);
    fireTimers();
    expect(el.classList.contains("tip-show")).toBe(true);
    up({});
    expect(el.classList.contains("tip-show")).toBe(false);
  });

  test("pointercancel clears the tooltip too", () => {
    const el = fakeTipEl();
    down({ target: el });
    fireTimers();
    expect(el.classList.contains("tip-show")).toBe(true);
    cancel({});
    expect(el.classList.contains("tip-show")).toBe(false);
  });

  test("releasing before 450ms cancels the tooltip", () => {
    const el = fakeTipEl();
    down({ target: el });
    up({});
    fireTimers();
    expect(el.classList.contains("tip-show")).toBe(false);
  });

  test("non-tip targets schedule nothing", () => {
    down({ target: fakePlainEl() });
    expect(timers.size).toBe(0);
  });
});

/* #534: t-shortcut toggle guard — fetch faked with controllable resolution.
   Installed per-test and restored after, so the fake never leaks into other
   test files sharing this process's globalThis. */
const fetchCalls: string[] = [];
let fetchResolvers: ((v: any) => void)[] = [];
const realFetch = g.fetch;
function fakeFetch(url: string) {
  fetchCalls.push(url);
  return new Promise((resolve) => fetchResolvers.push(resolve as (v: any) => void));
}
function resolveFetches() {
  const rs = fetchResolvers;
  fetchResolvers = [];
  rs.forEach((r) => r({ ok: true }));
}
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const key = on("keydown");
function keyT(repeat = false) {
  key({
    key: "t",
    repeat,
    target: {},
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {},
  });
}

describe("t toggle guard", () => {
  /* #538: stub FormData so the tests can see what the toggle serialized —
     bun has no DOM forms. querySelector returns a fake start form by
     default; FormData/setInterval are restored after so nothing leaks into
     other test files sharing this process's globalThis. */
  const realFormData = g.FormData;
  const realSetInterval = g.setInterval;
  const realQuerySelector = g.document.querySelector;
  const fakeForm = { tagName: "FORM" };
  let formDataArgs: unknown[] = [];
  class FakeFormData {
    constructor(form?: unknown) {
      formDataArgs.push(form === undefined ? "empty" : form);
    }
  }
  beforeEach(() => {
    fetchCalls.length = 0;
    fetchResolvers = [];
    formDataArgs = [];
    g.fetch = fakeFetch;
    g.FormData = FakeFormData;
    /* The start path arms the tab ticker — fake the interval so no real
       timer is scheduled in the test process. */
    g.setInterval = () => 1;
    /* #540: no modal dialog open by default — the scrim selector matches
       nothing, everything else gets the fake start form. */
    g.document.querySelector = (sel) =>
      sel === ".cal-scrim:not([hidden])" ? null : fakeForm;
    /* Stop path: disarmTicker is a no-op without a live interval, so the
       real setInterval in ticker.start is never armed. */
    g.document.body.dataset.timerRunning = "1";
  });
  afterEach(() => {
    g.fetch = realFetch;
    g.FormData = realFormData;
    g.setInterval = realSetInterval;
    g.document.querySelector = realQuerySelector;
  });

  test("key auto-repeat never toggles", () => {
    keyT(true);
    expect(fetchCalls.length).toBe(0);
  });

  test("a press while a toggle is in flight fires no second request", async () => {
    keyT();
    expect(fetchCalls).toEqual(["/timer/stop"]);
    keyT(); // still in flight — ignored
    expect(fetchCalls.length).toBe(1);
    resolveFetches();
    await flush();
    expect(fetchCalls.length).toBe(1);
    g.document.body.dataset.timerRunning = "1"; // back to the stop path
    keyT(); // flight done — allowed again
    expect(fetchCalls).toEqual(["/timer/stop", "/timer/stop"]);
    resolveFetches();
    await flush();
  });

  /* #538: pressing t with a description typed must behave like clicking
     Start — the card's start form is serialized on the start path. */
  test("start serializes the timer card's start form", async () => {
    g.document.body.dataset.timerRunning = "0";
    keyT();
    expect(fetchCalls).toEqual(["/timer/start"]);
    expect(formDataArgs).toEqual([fakeForm]);
    resolveFetches();
    await flush();
  });

  test("stop keeps an empty body", async () => {
    g.document.body.dataset.timerRunning = "1";
    keyT();
    expect(fetchCalls).toEqual(["/timer/stop"]);
    expect(formDataArgs).toEqual(["empty"]);
    resolveFetches();
    await flush();
  });

  test("start with no card form falls back to an empty body", async () => {
    g.document.body.dataset.timerRunning = "0";
    g.document.querySelector = (_sel: string) => null; // other pages have no timer card
    keyT();
    expect(fetchCalls).toEqual(["/timer/start"]);
    expect(formDataArgs).toEqual(["empty"]);
    resolveFetches();
    await flush();
  });

  /* #540: a press with a modal dialog open never toggles — the timer must
     not flip behind the scrim. */
  test("press with an open modal dialog fires nothing", async () => {
    g.document.querySelector = (sel: string) =>
      sel === ".cal-scrim:not([hidden])" ? { tagName: "DIV" } : fakeForm;
    keyT();
    expect(fetchCalls.length).toBe(0);
    await flush();
    expect(fetchCalls.length).toBe(0);
  });
});
