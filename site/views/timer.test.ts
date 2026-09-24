/** #444: the tab-title ticker is site-wide, not card-scoped.
 *
 *  #440's ticker lived in the timer card's inline script, so full page loads
 *  (e.g. opening the Calendar) wiped its interval. The ticker now lives in
 *  shortcut.js, which loads on every app page:
 *   - layout() renders body[data-timer-start] from the running entry;
 *   - shortcut.js starts the ticker from it on load, and re-arms/stops it on
 *     /timer/start|stop swaps;
 *   - the timer card keeps its own elapsed display but never touches
 *     document.title, and still clears its display interval on re-renders so
 *     no zombie setInterval is left on a detached node.
 */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { createTimerViews } from "./timer.ts";
import { createLayoutViews } from "./layout.ts";

const stubQuery = () => ({
  get: (..._a: unknown[]) => null,
  all: (..._a: unknown[]) => [],
  run: (..._a: unknown[]) => {},
});
const stubDb = { query: (_sql: string) => stubQuery() } as unknown as Database;

const baseDeps = {
  db: stubDb,
  qRange: { all: () => [] } as unknown as Statement,
  layout: (_t: string, b: string) => b,
  demoBanner: () => "",
  projectOptions: () => "",
  revenueTotals: () => ({ invoiced: 0, paid: 0, outstanding: 0 }),
  revenueMonthly: () => [],
  revenueByClient: () => [],
  revenueOverdue: () => [],
  m3ProgressBar: () => "",
  dayTargetSecs: 8 * 3600,
};

const runningEntry = {
  id: 1, start_time: "2026-09-23T10:00:00.000Z", end_time: null,
  description: "deep work", project_name: null, client_name: null,
  client_color: null, invoice_id: null, invoice_status: null,
};

function partial(running: boolean) {
  const deps = {
    ...baseDeps,
    qRunning: { get: () => (running ? runningEntry : null) } as unknown as Statement,
  };
  return createTimerViews(deps as any).timerPartial();
}

function layoutHtml(running: boolean) {
  const views = createLayoutViews(
    { get: () => (running ? runningEntry : null) } as unknown as Statement
  );
  return views.layout("Timer", "<p>body</p>", "timer");
}

describe("timer card scripts (#444)", () => {
  test("running card never touches the tab title", () => {
    const html = partial(true);
    expect(html).not.toContain("document.title");
    expect(html).not.toContain("__tkBaseTitle");
  });

  test("running card still retires its own display interval on re-render", () => {
    const html = partial(true);
    expect(html).toContain("clearInterval(window.__tkTick)");
    // exactly one display interval is ever armed per render
    expect(html.match(/setInterval\(tick,1000\)/g)?.length).toBe(1);
  });

  test("stopped card retires the display interval but leaves the title alone", () => {
    const html = partial(false);
    expect(html).toContain("clearInterval(window.__tkTick)");
    expect(html).not.toContain("document.title");
    expect(html).not.toContain("__tkBaseTitle");
    expect(html).not.toContain("setInterval(tick");
  });
});

describe("layout timer attributes (#444)", () => {
  test("emits data-timer-start with the running entry's start instant", () => {
    const html = layoutHtml(true);
    expect(html).toContain('data-timer-running="1"');
    expect(html).toContain('data-timer-start="2026-09-23T10:00:00.000Z"');
  });

  test("no data-timer-start when nothing is tracking", () => {
    const html = layoutHtml(false);
    expect(html).toContain('data-timer-running="0"');
    expect(html).not.toContain("data-timer-start");
  });
});

describe("shortcut.js site-wide ticker (#444)", () => {
  test("starts from body[data-timer-start] on page load", async () => {
    const js = await Bun.file("site/static/shortcut.js").text();
    expect(js).toContain('document.body.dataset.timerRunning === "1"');
    expect(js).toContain("document.body.dataset.timerStart");
  });

  test("re-arms on /timer/start and stops + restores on /timer/stop", async () => {
    const js = await Bun.file("site/static/shortcut.js").text();
    expect(js).toContain('"/timer/start"');
    expect(js).toContain("armTicker()");
    expect(js).toContain('"/timer/stop"');
    expect(js).toContain("disarmTicker()");
    expect(js).toContain("document.title = baseTitle");
    expect(js).toContain('" · Timekeep"');
  });

  test("the t shortcut drives the ticker directly (no htmx:afterRequest on raw fetch)", async () => {
    const js = await Bun.file("site/static/shortcut.js").text();
    const toggleBody = js.slice(js.indexOf("async function toggle()"), js.indexOf("document.addEventListener(\"keydown\""));
    expect(toggleBody).toContain("disarmTicker()");
    expect(toggleBody).toContain("armTicker()");
  });
});

describe("shortcut.js t toggle parity (#454)", () => {
  test("t toggle fires timer-updated like the button path", async () => {
    const js = await Bun.file("site/static/shortcut.js").text();
    const toggleBody = js.slice(js.indexOf("async function toggle()"), js.indexOf("document.addEventListener(\"keydown\""));
    // the button path fires this via the server's HX-Trigger header; the
    // raw-fetch shortcut must fire the same event so the today list refreshes
    expect(toggleBody).toContain('htmx.trigger(document.body, "timer-updated")');
  });
});

describe("running entry row delete guard (#462)", () => {
  const stoppedEntry = { ...runningEntry, end_time: "2026-09-23T11:30:00.000Z" };
  function row(entry: typeof runningEntry) {
    return createTimerViews({ ...baseDeps, qRunning: stubQuery() } as any).entryRow(entry as any);
  }
  test("running entry keeps Edit but hides Delete (the card owns it)", () => {
    const html = row(runningEntry);
    expect(html).toContain("/entries/1/edit");
    expect(html).not.toContain("hx-delete");
  });
  test("finished entry keeps both Edit and Delete", () => {
    const html = row(stoppedEntry);
    expect(html).toContain("/entries/1/edit");
    expect(html).toContain("hx-delete");
  });
});
