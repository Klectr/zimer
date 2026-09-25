/** #496: site-wide 450ms long-press reveals M3 plain tooltips on touch.
 *
 *  shortcut.js runs in the browser with real DOM; here it loads against tiny
 *  fakes so bun can exercise the long-press logic: tip-show is added after
 *  450ms on a [data-tip] target, cleared on pointerup/pointercancel, nothing
 *  is scheduled for non-tip targets, and releasing early cancels the timer.
 */
import { beforeEach, describe, expect, test } from "bun:test";

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

g.document = {
  title: "Timekeep",
  body: { dataset: {} },
  _listeners: {} as Record<string, Function[]>,
  addEventListener(t: string, h: Function) {
    (this._listeners[t] ||= []).push(h);
  },
  getElementById: () => null,
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
