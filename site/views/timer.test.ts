/** #440: tab-title ticker + tick-interval lifecycle.
 *
 *  The timer card's tick script must (a) clear any previous __tkTick interval
 *  before starting a new one — the card re-renders on every start/stop, and
 *  each re-render used to orphan a setInterval on a detached node — and
 *  (b) write the live elapsed time into document.title while tracking.
 *  The stopped card must retire the interval and restore the original title.
 */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { createTimerViews } from "./timer.ts";

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

describe("timer tick script (#440)", () => {
  test("running card clears any previous interval before starting a new one", () => {
    const html = partial(true);
    expect(html).toContain("clearInterval(window.__tkTick)");
    // exactly one interval is ever armed per render
    expect(html.match(/setInterval\(tick,1000\)/g)?.length).toBe(1);
  });

  test("running card writes live elapsed into the tab title", () => {
    const html = partial(true);
    expect(html).toContain("document.title=t+' · Timekeep'");
    expect(html).toContain("window.__tkBaseTitle");
  });

  test("stopped card retires the ticker and restores the original title", () => {
    const html = partial(false);
    expect(html).toContain("clearInterval(window.__tkTick)");
    expect(html).toContain("window.__tkTick=null");
    expect(html).toContain("document.title=window.__tkBaseTitle");
    expect(html).not.toContain("setInterval");
  });
});
