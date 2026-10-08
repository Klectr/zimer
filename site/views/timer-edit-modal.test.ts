/** #903: the timer page's edit-entry modal — dialog shell, open-button hooks,
 *  and wiring that closes the modal on a successful htmx save. */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { createTimerViews } from "./timer.ts";

const stubQuery = () => ({
  get: (..._a: unknown[]) => null,
  all: (..._a: unknown[]) => [],
  run: (..._a: unknown[]) => {},
});
const stubDb = { query: (_sql: string) => stubQuery() } as unknown as Database;

function page(): string {
  return createTimerViews({
    db: stubDb,
    qRunning: { get: () => null } as unknown as Statement,
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
  } as any).dashboardPage();
}

describe("timer edit modal (#903)", () => {
  test("dialog shell renders once, outside HTMX-swapped regions", () => {
    const html = page();
    expect(html).toContain('id="entry-edit-scrim"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="entry-edit-body"');
    expect(html).toContain('id="entry-edit-close"');
    // lazy-loaded body placeholder
    expect(html).toContain("Loading…");
  });

  test("save flow closes the modal and refreshes the today list", () => {
    const html = page();
    // the modal lazy-loads the form via htmx into the dialog body
    expect(html).toContain('"/entries/"+id+"/edit-modal"');
    // on a successful POST /entries/:id save, the modal closes while the
    // server's HX-Trigger(timer-updated) refreshes #today-list
    expect(html).toContain("match(/\\/entries\\/(\\d+)$/)");
    expect(html).toContain("Entry saved");
    expect(html).toContain("tkSnackbar");
  });
});
