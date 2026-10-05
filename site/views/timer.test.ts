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
import { Database as BunDatabase } from "bun:sqlite";
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
    expect(js).toContain('" · Zimer"');
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

describe("running entry row live duration (#469)", () => {
  const stoppedEntry = { ...runningEntry, end_time: "2026-09-23T11:30:00.000Z" };
  function row(entry: typeof runningEntry) {
    return createTimerViews({ ...baseDeps, qRunning: stubQuery() } as any).entryRow(entry as any);
  }
  test("running entry row carries data-live-start for the card ticker", () => {
    expect(row(runningEntry)).toContain('data-live-start="2026-09-23T10:00:00.000Z"');
  });
  test("finished entry row has no live duration hook", () => {
    expect(row(stoppedEntry)).not.toContain("data-live-start");
  });
  test("card tick script updates the live row with a fmtDur mirror", () => {
    const html = partial(true);
    expect(html).toContain("querySelector('#today-list [data-live-start]')");
    // mirror of site/lib/format.ts fmtDur: "1h 02m" / "3m 24s" / "3m" / "45s"
    expect(html).toContain("return h+'h '+String(m).padStart(2,'0')+'m'");
    expect(html).toContain("return m+'m'+(sec>0?' '+String(sec).padStart(2,'0')+'s':'')");
    expect(html).toContain("return sec+'s'");
  });
  test("stopped card renders no live ticker", () => {
    // the stopped card only retires the old interval — no row-ticking logic
    expect(partial(false)).not.toContain("data-live-start");
  });
});

describe("repeat entry (#473)", () => {
  const finished = {
    id: 2, start_time: "2026-09-23T10:00:00.000Z", end_time: "2026-09-23T18:00:00.000Z",
    description: "deep work", project_id: 7, project_name: "Acme",
    client_name: null, client_color: null, invoice_id: null, invoice_status: null,
  };
  function row(entry: typeof finished, canRepeat: boolean) {
    return createTimerViews({ ...baseDeps, qRunning: stubQuery() } as any).entryRow(entry as any, 0, canRepeat);
  }
  test("finished unlocked entry offers repeat when nothing is running", () => {
    const html = row(finished, true);
    expect(html).toContain('hx-post="/timer/start"');
    expect(html).toContain('name="description" value="deep work"');
    expect(html).toContain('name="project_id" value="7"');
    expect(html).toContain('aria-label="Repeat entry"');
    expect(html).toContain('hx-target="#timer-card"');
  });
  test("repeat values survive quotes and apostrophes in the description", () => {
    const tricky = { ...finished, description: `Bob's "big" call`, project_id: null };
    const html = row(tricky, true);
    expect(html).toContain('value="Bob&#39;s &quot;big&quot; call"');
    expect(html).toContain('name="project_id" value=""');
  });
  test("running row never offers repeat", () => {
    const html = row({ ...runningEntry, project_id: 7 } as any, true);
    expect(html).not.toContain('hx-post="/timer/start"');
  });
  test("no repeat while another timer is running", () => {
    const html = row(finished, false);
    expect(html).not.toContain('hx-post="/timer/start"');
    // edit + delete stay put
    expect(html).toContain("/entries/2/edit");
    expect(html).toContain("hx-delete");
  });
  test("locked (invoiced) entries offer no repeat", () => {
    const html = row({ ...finished, invoice_status: "sent" }, true);
    expect(html).not.toContain('hx-post="/timer/start"');
  });
});

describe("today list repeat wiring (#473)", () => {
  const finishedRow = {
    id: 2, start_time: "2026-09-23T10:00:00.000Z", end_time: "2026-09-23T11:30:00.000Z",
    description: "deep work", project_id: 7, project_name: null,
    client_name: null, client_color: null, invoice_id: null, invoice_status: null,
  };
  function today(running: boolean) {
    const deps = {
      ...baseDeps,
      qRunning: { get: () => (running ? runningEntry : null) } as unknown as Statement,
      qRange: { all: () => [finishedRow] } as unknown as Statement,
    };
    return createTimerViews(deps as any).todayPartial();
  }
  test("today list shows repeat on finished rows when idle", () => {
    expect(today(false)).toContain('hx-post="/timer/start"');
  });
  test("today list hides repeat while a timer is running", () => {
    expect(today(true)).not.toContain('hx-post="/timer/start"');
  });
});

describe("timer card stop button (#475)", () => {
  test("running card's stop button keeps the stop positioning class", () => {
    const html = partial(true);
    // .timer-top-row .stop positions the button top-right; without the
    // class it drops below the TRACKING label in normal flow.
    expect(html).toContain('class="md-filled-button stop" hx-post="/timer/stop"');
  });
  test("idle card has no stop button", () => {
    expect(partial(false)).not.toContain("/timer/stop");
  });
});

describe("tracking label project name (#718)", () => {
  function partialWithProject(name: string | null) {
    const entry = { ...runningEntry, project_name: name };
    const deps = {
      ...baseDeps,
      qRunning: { get: () => entry } as unknown as Statement,
    };
    return createTimerViews(deps as any).timerPartial();
  }
  test("project name rides in a no-wrap span, never bare text", () => {
    // the span keeps the label from splitting the name mid-phrase on narrow
    // screens — style.css ellipsizes it instead. The "·" separator rides
    // inside the span so it can't detach from the name.
    expect(partialWithProject("Brand refresh")).toContain(
      '<span class="timer-state-proj">· Brand refresh</span>');
  });
  test("no project renders no span", () => {
    expect(partialWithProject(null)).not.toContain("timer-state-proj");
  });
});

describe("running card description ellipsis (#761)", () => {
  test("description carries timer-desc so it ellipsizes clear of the Stop button", () => {
    // the Stop button is absolutely positioned — without the class a long
    // description slides under it and clips mid-word on narrow screens.
    expect(partial(true)).toContain(
      '<div class="md-title-medium timer-desc">deep work</div>');
  });
  test("blank description still gets the class", () => {
    const entry = { ...runningEntry, description: "" };
    const deps = {
      ...baseDeps,
      qRunning: { get: () => entry } as unknown as Statement,
    };
    expect(createTimerViews(deps as any).timerPartial()).toContain(
      '<div class="md-title-medium timer-desc">No description</div>');
  });
});

describe("timer card annotation hygiene (#477)", () => {
  // A /* ... */ note once sat inside the template literal and rendered as
  // visible text between the TRACKING label and the Stop button. Inline
  // <script> blocks legitimately contain JS comments, so strip them before
  // asserting the HTML carries no comment text.
  const noScripts = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
  test("running card emits no JS-style comment text", () => {
    expect(noScripts(partial(true))).not.toContain("/*");
  });
  test("idle card emits no JS-style comment text", () => {
    expect(noScripts(partial(false))).not.toContain("/*");
  });
});

describe("entry row tooltips (#484)", () => {
  const finished = {
    id: 2, start_time: "2026-09-23T10:00:00.000Z", end_time: "2026-09-23T11:30:00.000Z",
    description: "deep work", project_id: null, project_name: null,
    client_name: null, client_color: null, invoice_id: null, invoice_status: null,
  };
  function row(entry: typeof finished) {
    return createTimerViews({ ...baseDeps, qRunning: stubQuery() } as any).entryRow(entry as any);
  }
  test("edit uses the house data-tip tooltip, not the native title", () => {
    const html = row(finished);
    // the native OS tooltip renders differently from the M3 plain tooltips
    // the invoice action buttons use — one house system for all of them.
    expect(html).toContain('data-tip="Edit"');
    expect(html).not.toContain('title="Edit"');
  });
  test("delete gets a data-tip tooltip", () => {
    const html = row(finished);
    expect(html).toContain('data-tip="Delete"');
    expect(html).not.toContain('title="Delete"');
  });
  test("running row's edit keeps the tooltip; no delete on running rows", () => {
    const html = row(runningEntry as any);
    expect(html).toContain('data-tip="Edit"');
    expect(html).not.toContain("hx-delete");
    expect(html).not.toContain('data-tip="Delete"');
  });
  test("inv-mark chip uses the house data-tip tooltip, not the native title (#498)", () => {
    const html = row({ ...finished, invoice_number: "INV-0042", invoice_status: "sent" } as any);
    // native title shows an OS-styled tooltip and never fires on touch —
    // the chip joins the M3 plain tooltip system (450ms long-press, #496).
    expect(html).toContain('class="inv-mark "');
    expect(html).toContain('data-tip="Zinvoiced on INV-0042"');
    expect(html).not.toContain('title="Zinvoiced on INV-0042"');
  });
});

describe("skip link (#511)", () => {
  test("layout renders a skip link targeting the main content", () => {
    const html = layoutHtml(false);
    expect(html).toContain('<a class="skip-link" href="#main">Skip to content</a>');
    expect(html).toContain('<main id="main" tabindex="-1"');
  });

  test("skip link is the first focusable thing inside body", () => {
    const html = layoutHtml(false);
    const bodyStart = html.indexOf("<body");
    const linkPos = html.indexOf('<a class="skip-link"');
    expect(linkPos).toBeGreaterThan(bodyStart);
    // nothing focusable precedes it — keyboard users land on it first
    expect(html.slice(bodyStart, linkPos)).not.toMatch(/<(a|button|input|select|textarea)[ >]/);
  });
});

describe("timer shortcut hint (#532)", () => {
  test("Start button advertises the t shortcut in its tooltip", () => {
    const html = partial(false);
    expect(html).toContain('data-tip="Start (t)"');
    expect(html).toContain('aria-keyshortcuts="t"');
  });
  test("Stop button advertises the t shortcut in its tooltip", () => {
    const html = partial(true);
    expect(html).toContain('data-tip="Stop (t)"');
    expect(html).toContain('aria-keyshortcuts="t"');
  });
  test("filled-button tooltip styles exist in the house data-tip system", async () => {
    const css = await Bun.file("site/static/style.css").text();
    expect(css).toContain(".md-filled-button[data-tip]");
    expect(css).toContain(".md-filled-button[data-tip]:focus-visible::before");
    expect(css).toContain(".md-filled-button[data-tip].tip-show::before");
  });
});

/** #546: the stopped card's start form suggests past descriptions through a
 *  browser-native datalist — the 15 most recently used non-blank
 *  descriptions, deduped, HTML-escaped. Zero visual surface until the field
 *  is focused or typed in; the running card has no input and gets none. */
describe("timer description suggestions (#546)", () => {
  function dbWith(descs: { d: string; t: string }[]) {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      description TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL,
      end_time TEXT
    )`);
    const ins = db.query("INSERT INTO time_entries (description, start_time) VALUES (?, ?)");
    for (const { d, t } of descs) ins.run(d, t);
    return db;
  }

  function partialWithDb(db: unknown, running: boolean) {
    const deps = {
      ...baseDeps,
      db,
      qRunning: { get: () => (running ? runningEntry : null) } as unknown as Statement,
    };
    return createTimerViews(deps as any).timerPartial();
  }

  test("stopped card lists distinct non-blank descriptions, newest first", () => {
    const db = dbWith([
      { d: "PriceBook work", t: "2026-09-26T08:00:00.000Z" },
      { d: "emails", t: "2026-09-26T09:00:00.000Z" },
      { d: "PriceBook work", t: "2026-09-26T10:00:00.000Z" },
      { d: "  ", t: "2026-09-26T11:00:00.000Z" },
      { d: "", t: "2026-09-26T12:00:00.000Z" },
    ]);
    const html = partialWithDb(db, false);
    expect(html).toContain('list="tk-desc-suggest"');
    expect(html).toContain('<datalist id="tk-desc-suggest">');
    const opts = html.slice(html.indexOf('<datalist id="tk-desc-suggest">'), html.indexOf("</datalist>"));
    expect(opts.match(/<option value="/g)?.length).toBe(2);
    // deduped and ordered by most recent use: PriceBook (10:00) before emails (09:00)
    expect(opts.indexOf('value="PriceBook work"')).toBeLessThan(opts.indexOf('value="emails"'));
  });

  test("suggestions are capped at 15", () => {
    const descs = Array.from({ length: 20 }, (_, i) => ({
      d: `task ${i}`, t: `2026-09-26T${String(i).padStart(2, "0")}:00:00.000Z`,
    }));
    const html = partialWithDb(dbWith(descs), false);
    const opts = html.slice(html.indexOf('<datalist id="tk-desc-suggest">'), html.indexOf("</datalist>"));
    expect(opts.match(/<option value="/g)?.length).toBe(15);
  });

  test("values are HTML-escaped", () => {
    const db = dbWith([{ d: 'Foo & "Bar" <x>', t: "2026-09-26T08:00:00.000Z" }]);
    const html = partialWithDb(db, false);
    expect(html).toContain('value="Foo &amp; &quot;Bar&quot; &lt;x&gt;"');
    expect(html).not.toContain('Foo & "Bar" <x>');
  });

  test("no datalist when nothing has been described yet", () => {
    const html = partialWithDb(dbWith([]), false);
    expect(html).not.toContain("<datalist");
    // the input still renders plainly — nothing visual changes
    expect(html).toContain('name="description"');
  });

  test("running card gets no suggestion list (it has no description input)", () => {
    const db = dbWith([{ d: "PriceBook work", t: "2026-09-26T08:00:00.000Z" }]);
    const html = partialWithDb(db, true);
    expect(html).not.toContain("<datalist");
  });
});

describe("dashboard document title (#798)", () => {
  test("title is the page heading, not the brand (no 'Zimer · Zimer')", () => {
    let captured = "";
    const deps = {
      ...baseDeps,
      qRunning: { get: () => null } as unknown as Statement,
      layout: (t: string, b: string) => { captured = t; return b; },
    };
    createTimerViews(deps as any).dashboardPage();
    expect(captured).toBe("Today");
    expect(captured).not.toBe("Zimer");
  });
});
