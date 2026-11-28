import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../static/style.css"), "utf8");

const INLINE_SET_VARS = ["--cal-hour", "--dot", "--entry"];

describe("legacy snapshot compat", () => {
  test("the sheet table rules keep their .md-table aliases for frozen snapshots (#301)", () => {
    expect(css).toContain(".invoice-sheet .md-table");
    expect(css).toContain(".template-modern .md-table");
  });

  /* #1133: desktop visuals are forked — .md-table (frozen) keeps the legacy
     card-row declarations; .inv-table (live) carries hairline rows. */
  test("the frozen .md-table keeps its legacy row fill; the live .inv-table is hairline-only", () => {
    const legacy = css.match(/\.md-table tbody tr \{[^}]*\}/);
    expect(legacy).not.toBeNull();
    expect(legacy![0]).toContain("background: var(--color-bg-container)");
    const live = css.match(/\.inv-table tbody tr \{[^}]*\}/);
    expect(live).not.toBeNull();
    expect(live![0]).toContain("border-bottom: 1px solid var(--color-border-secondary)");
    expect(live![0]).not.toContain("background");
    const liveHead = css.match(/\.inv-table thead th \{[^}]*\}/);
    expect(liveHead).not.toBeNull();
    expect(liveHead![0]).not.toContain("text-transform");
    const modernLive = css.match(/\.template-modern \.inv-table thead th \{[^}]*\}/);
    expect(modernLive).not.toBeNull();
    expect(modernLive![0]).toContain("background: transparent");
    expect(modernLive![0]).toContain("text-transform: none");
  });
});

describe("native picker indicators (#1220)", () => {
  test("datalist, date, time and datetime-local indicators are hidden", () => {
    expect(css).toContain('input[list]::-webkit-calendar-picker-indicator');
    expect(css).toContain('input[type="date"]::-webkit-calendar-picker-indicator');
    expect(css).toContain('input[type="time"]::-webkit-calendar-picker-indicator');
    expect(css).toContain('input[type="datetime-local"]::-webkit-calendar-picker-indicator');
    const rule = css.match(/input\[list\]::-webkit-calendar-picker-indicator,[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("display: none");
  });
});

describe("on-filled text token (#1095)", () => {
  test("the token is defined and the solid-error button uses it, not a surface token", () => {
    expect(css).toContain("--color-text-on-filled: #08090a;");
    const rule = css.match(/\.ui-btn-primary\.ui-btn-danger \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("color: var(--color-text-on-filled)");
    expect(css).not.toMatch(/(?:color|fill):\s*var\(--color-bg-/);
  });
});

describe("demo banner (#1218)", () => {
  test("the banner sits on a neutral surface — no primary wash or border", () => {
    const rule = css.match(/\.demo-banner \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("background: var(--color-fill-tertiary)");
    expect(rule![0]).toContain("border: 1px solid var(--color-border-secondary)");
    expect(rule![0]).not.toContain("primary");
    const icon = css.match(/\.demo-banner > svg \{[^}]*\}/);
    expect(icon).not.toBeNull();
    expect(icon![0]).toContain("color: var(--color-text-secondary)");
    expect(icon![0]).not.toContain("var(--color-primary)");
  });
});

describe("today column and card (#1271)", () => {
  test("no is-today rule paints a primary wash or border — today is marked by the bold header, the dot and the now-line", () => {
    const todayRules = [...css.matchAll(/\.is-today[^{]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(todayRules.length).toBeGreaterThan(0);
    for (const rule of todayRules) {
      expect(rule).not.toContain("background");
      expect(rule).not.toContain("border");
      expect(rule).not.toContain("--color-primary");
    }
    const vizName = css.match(/\.ui-viz-day-head\.is-today \.ui-viz-day-name \{[^}]*\}/);
    expect(vizName).not.toBeNull();
    expect(vizName![0]).toContain("font-weight: var(--font-weight-strong)");
    const dayName = css.match(/\.ui-day\.is-today \.ui-day-name \{[^}]*\}/);
    expect(dayName).not.toBeNull();
    expect(dayName![0]).toContain("font-weight: var(--font-weight-strong)");
  });
});

describe("viz day header gutter (#1219)", () => {
  test("the header inner carries the column body's inset, so a day's total is separated from the next day's label and aligns with the blocks below", () => {
    const inner = css.match(/\.ui-viz-day-inner \{[^}]*\}/);
    expect(inner).not.toBeNull();
    expect(inner![0]).toContain("padding-inline: var(--spacing-xxs)");
    expect(inner![0]).toContain("box-sizing: border-box");
  });
});

describe("viz hour labels never clip (#1302)", () => {
  test("the viz carries half a label height of block padding, so the last hour label clears the bottom scroll edge", () => {
    const viz = css.match(/\.ui-viz \{[^}]*\}/);
    expect(viz).not.toBeNull();
    expect(viz![0]).toContain(
      "padding-block: calc(var(--font-size-sm) * var(--line-height-sm) / 2)",
    );
    const hour = css.match(/\.ui-viz-hour \{[^}]*\}/);
    expect(hour).not.toBeNull();
    expect(hour![0]).toContain("line-height: var(--line-height-sm)");
  });

  test("the hour gutter fits the widest label (5 code-font glyphs at 12px plus the right offset)", () => {
    const viz = css.match(/\.ui-viz \{[^}]*\}/);
    expect(viz).not.toBeNull();
    expect(viz![0]).toContain("grid-template-columns: 52px repeat(7, 1fr)");
    const hour = css.match(/\.ui-viz-hour \{[^}]*\}/);
    expect(hour).not.toBeNull();
    expect(hour![0]).toContain("right: var(--spacing-xs)");
    expect(hour![0]).toContain("white-space: nowrap");
  });
});

describe("viz block title wrap (#1219)", () => {
  test("tall blocks wrap the title to two lines; the base title stays one-line ellipsis", () => {
    const tall = css.match(/\.ui-viz-block\.is-tall \.ui-viz-block-title \{[^}]*\}/);
    expect(tall).not.toBeNull();
    expect(tall![0]).toContain("-webkit-line-clamp: 2");
    expect(tall![0]).toContain("white-space: normal");
    const base = css.match(/\.ui-viz-block-title \{[^}]*\}/);
    expect(base).not.toBeNull();
    expect(base![0]).toContain("white-space: nowrap");
  });
});

describe("public invoice total (#1277)", () => {
  test("the public sheet total uses the text color, not primary; the app summary keeps primary", () => {
    const pub = css.match(/\.ui-public \.ui-summary-total \.num \{[^}]*\}/);
    expect(pub).not.toBeNull();
    expect(pub![0]).toContain("color: var(--color-text)");
    expect(pub![0]).not.toContain("primary");
    const shared = css.match(/\.ui-summary-total \.num \{[^}]*\}/);
    expect(shared).not.toBeNull();
    expect(shared![0]).toContain("color: var(--color-primary)");
    const print = css.slice(css.indexOf("@media print"));
    const printPub = print.match(/\.ui-public \.ui-summary-total \.num \{[^}]*\}/);
    expect(printPub).not.toBeNull();
    expect(printPub![0]).toContain("color: #111");
  });
});

describe("style.css token references", () => {
  test("every var() reference resolves to a definition (or an inline-set legacy var)", () => {
    const defs = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const refs = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    const unresolved = [...refs].filter((r) => !defs.has(r) && !INLINE_SET_VARS.includes(r));
    expect(unresolved).toEqual([]);
  });
});

describe("setting rows", () => {
  test("setting row wraps so a wide control stacks instead of overflowing (#1216)", () => {
    const rule = css.match(/\.ui-setting-row \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("flex-wrap: wrap");
  });
});



describe("invoice list compact rows (#1210)", () => {
  /* Keyed to the table card's width (container query), not the viewport:
     a narrow card on a wide window must stack too, never scroll sideways. */
  test("on a narrow card the list rows stack instead of scrolling sideways", () => {
    expect(css).toContain(".inv-table-card { container-type: inline-size; }");
    const block = css.match(/@container \(max-width: 559px\) \{[^]*?\n\}/);
    expect(block).not.toBeNull();
    const b = block![0];
    expect(b).toContain(".inv-table-card .table-wrap");
    expect(b).toContain("overflow-x: visible");
    expect(b).toContain(".inv-table-card tbody tr");
    expect(b).toContain("display: flex");
    expect(b).toContain("flex-wrap: wrap");
    expect(b).toContain(".inv-table-card td.inv-status-cell { order: 4; margin-left: auto;");
    expect(b).toContain(".inv-table-card thead");
    expect(b).toContain("clip-path: inset(50%)");
    expect(b).toMatch(/td\.num \{ order: 2;/);
  });

  test("invoice numbers never wrap", () => {
    const rule = css.match(/\.inv-num-link \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("white-space: nowrap");
  });
});

describe("invoice stat row on mobile (#1222)", () => {
  test("below 640px the stats are compact rows, not full-height cards", () => {
    const block = css.match(/@media \(max-width: 639px\) \{\n  \.ui-stat-row \{[^]*?\n\}/);
    expect(block).not.toBeNull();
    const b = block![0];
    const row = b.match(/\.ui-stat-row \{[^}]*\}/);
    expect(row).not.toBeNull();
    expect(row![0]).toContain("grid-template-columns: 1fr");
    expect(row![0]).toContain("gap: var(--spacing-sm)");
    const card = b.match(/\.ui-stat-row \.ui-card \{[^}]*\}/);
    expect(card).not.toBeNull();
    expect(card![0]).toContain("padding: var(--spacing-sm) var(--spacing)");
    const inner = b.match(/\.ui-stat-row \.ui-card > div \{[^}]*\}/);
    expect(inner).not.toBeNull();
    expect(inner![0]).toContain("display: flex");
    expect(inner![0]).toContain("flex-wrap: wrap");
    expect(inner![0]).toContain("align-items: baseline");
    const value = b.match(/\.ui-stat-row \.ui-stat-value \{[^}]*\}/);
    expect(value).not.toBeNull();
    expect(value![0]).toContain("font-size: var(--font-size-xl)");
    const sub = b.match(/\.ui-stat-row \.ui-stat-sub \{[^}]*\}/);
    expect(sub).not.toBeNull();
    expect(sub![0]).toContain("margin-left: auto");
    expect(sub![0]).toContain("min-width: 0");
  });
});

describe("invoice search alignment (#1257)", () => {
  test("the filter row centers the chips and the search input on the cross axis", () => {
    const rule = css.match(/\.inv-filter-row \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("align-items: center");
  });

  test("affix icons render at 16px, not the 24px svg default", () => {
    const rule = css.match(/\.ui-affix svg \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("width: 16px");
    expect(rule![0]).toContain("height: 16px");
  });

  test("below 640px the search takes the full row under the chips", () => {
    const block = css.match(/@media screen and \(max-width: 640px\) \{\n  \.inv-search \{[^]*?\n\}/);
    expect(block).not.toBeNull();
    const b = block![0];
    const form = b.match(/\.inv-search \{[^}]*\}/);
    expect(form).not.toBeNull();
    expect(form![0]).toContain("flex: 1 1 100%");
    expect(form![0]).toContain("margin-left: 0");
    const field = b.match(/\.inv-search \.ui-field \{[^}]*\}/);
    expect(field).not.toBeNull();
    expect(field![0]).toContain("min-width: 0");
  });
});

describe("internal notes label (#1221)", () => {
  test("the label renders in sentence case on the type scale — no uppercase eyebrow", () => {
    const rule = css.match(/\.internal-notes-label \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("font-size: var(--font-size-sm)");
    expect(rule![0]).not.toContain("text-transform");
    expect(rule![0]).not.toContain("letter-spacing");
  });
});

describe("type-scale weights and sizes (#1215 slice)", () => {
  test("invoice list emphasis uses fontWeightStrong 600, not off-system 550", () => {
    const amt = css.match(/\.inv-amt \{[^}]*\}/);
    expect(amt).not.toBeNull();
    expect(amt![0]).toContain("font-weight: 600");
    expect(css).not.toContain("font-weight: 550");
  });

  test("the timer invoice mark sits on the type scale at --font-size-sm", () => {
    const mark = css.match(/\.ui-inv-mark \{[^}]*\}/);
    expect(mark).not.toBeNull();
    expect(mark![0]).toContain("font-size: var(--font-size-sm)");
    expect(mark![0]).toContain("line-height: 1");
    expect(mark![0]).not.toContain("font-size: 10px");
  });

  test("app-chrome rules read type tokens, not font-size literals", () => {
    const cases: Array<[RegExp, string]> = [
      [/\.tb-chart text \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.ui-landing-title \{[^}]*font-size: [^}]*\}/, "var(--font-size-heading-2)"],
      [/\.tiny \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.skip-link \{[^}]*font-size: [^}]*\}/, "var(--font-size)"],
      [/\.cal-supporting \.week-clients \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.ui-mobile-nav \.ui-navitem \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.cal-supporting \.week-nav h1 \{[^}]*font-size: [^}]*\}/, "var(--font-size-xl)"],
      [/\.cal-supporting \.cal-summary \.cal-summary-total \{[^}]*font-size: [^}]*\}/, "var(--font-size-xl)"],
      [/\.share-url-wrap\[data-tip\]::after \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.nav-drawer-head \{[^}]*font-size: [^}]*\}/, "var(--font-size)"],
      [/\.nav-drawer-row \{[^}]*font-size: [^}]*\}/, "var(--font-size)"],
      [/\.terms-desc \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.status-row-headline \{[^}]*font-size: [^}]*\}/, "var(--font-size-lg)"],
      [/\.status-row-supporting \{[^}]*font-size: [^}]*\}/, "var(--font-size)"],
      [/\.status-row-supporting code \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.update-cmd \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.form-info \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.proof-meta \{[^}]*font-size: [^}]*\}/, "var(--font-size)"],
      [/\.proof-hint \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
      [/\.share-url \{[^}]*font-size: [^}]*\}/, "var(--font-size-sm)"],
    ];
    for (const [re, token] of cases) {
      const rule = css.match(re);
      expect(rule).not.toBeNull();
      expect(rule![0]).toContain(`font-size: ${token}`);
      expect(rule![0]).not.toMatch(/font-size: [0-9]/);
    }
  });

  test("chart text is on the type scale; the cal-hint keeps its compact size (#945)", () => {
    expect(css).not.toContain("font-size: 0.625rem");
    expect(css).toContain(".cal-supporting .cal-hint { font-size: 0.6875rem");
    expect(css).toContain(".cal-supporting .cal-hint { margin: 0; font-size: 0.6875rem");
    expect(css).not.toContain(".cal-supporting .week-clients { gap: 4px 12px; font-size: 0.8125rem");
    expect(css).toContain(".ui-landing-title { font-size: var(--font-size-heading-2);");
  });
});





/** #1211: on phones, fixed-viewport pages (timer, Zinvoices) scroll the
 *  document rather than a short inner region under pinned chrome; the
 *  calendar keeps its fixed strip height for the week carousel. */
describe("phones scroll the page, not an inner region (#1211, #1219)", () => {
  const compact = () => css.split("@media").find((b) => b.startsWith(" (max-width: 599px)") && b.includes("#1211"));
  test("the compact block releases app-fixed on every fixed page", () => {
    expect(compact()).toBeDefined();
    expect(compact()!).toContain("body.app-fixed { height: auto; overflow: visible; display: block; }");
  });

  /* Zimer and Zinvoices no longer pin the viewport at any width: the inner
     .scroll-region (short area, mid-page scrollbar) is gone with it. */
  test("no inner scroll region is left to release", () => {
    expect(css).not.toContain(".scroll-region");
  });
  test("calendar strips size to their week; neighbours collapse at rest, open while panning", () => {
    expect(compact()!).toContain("body.app-fixed .cal-track { height: auto; align-items: flex-start; }");
    expect(compact()!).toContain("body.app-fixed .cal-track:not(.is-panning) > .cal-strip:not(:nth-child(2)) { height: 0; overflow: hidden; }");
    expect(compact()!).toMatch(/body\.app-fixed \.cal-strip > \.ui-week \{[^}]*overflow: visible/);
  });
});

/** #1340: labelled buttons size their leading icon to 16px app-wide (it
 *  rendered at the SVG's intrinsic 24px); icon-only buttons stay 20px. */
describe("button icon size (#1340)", () => {
  test("one base rule sizes .ui-btn icons; no local patches remain", () => {
    expect(css).toContain(".ui-btn > svg, .nudge-chip .nudge-go > svg { width: 16px; height: 16px; flex: none; }");
    expect(css).toContain(".ui-icon-btn svg { width: 20px; height: 20px; }");
    expect(css).not.toContain(".demo-banner .ui-btn svg");
    expect(css).not.toContain(".ui-settings-grid .ui-btn svg");
  });
});

/** #1344: on phones the quiet client table keeps Client, Unbilled and
 *  Outstanding only — no month bar, last tracked or chevron — and client
 *  names may wrap, so the table fits a 375px screen. */
describe("clients table on phones (#1344)", () => {
  test("compact rules hide the wide columns and let names wrap", () => {
    expect(css).toContain(".manage-table-card .col-month { display: none; }");
    expect(css).toContain(".manage-table-card .col-last { display: none; }");
    expect(css).toContain(".manage-table-card .mg-chev, .manage-table-card .mg-table th:last-child { display: none; }");
    expect(css).toContain(".manage-table-card .mg-table td:first-child { white-space: normal; }");
  });

  /* The card overflowed at ~625px (wide viewport, narrow content column)
     because the tiers keyed off the viewport. They key off the card now. */
  test("tiers are container queries on the card, and the bar and hover card can shrink", () => {
    expect(css).toContain(".manage-table-card { container-type: inline-size; }");
    expect(css).toMatch(/@container \(max-width: 759px\) \{\s*\.manage-table-card \.col-last \{ display: none; \}/);
    expect(css).toMatch(/@container \(max-width: 519px\) \{\s*\.manage-table-card \.col-month \{ display: none; \}/);
    expect(css).not.toMatch(/\.mg-bar \{[^}]*\bwidth: 160px/);
    expect(css).toMatch(/\.mg-card \{[^}]*width: min\(280px, calc\(100cqw/);
  });

  test("the hover card only opens on hover-capable devices or keyboard focus", () => {
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.mg-row:hover \.mg-card/);
    expect(css).toContain(".mg-row:focus-visible .mg-card {");
  });
});

/** Small-display sweep: two tablet-width overflows. */
describe("tablet-width overflow fixes", () => {
  test("stat strip notes wrap under the number instead of running into the next cell", () => {
    expect(css).toMatch(/\.ui-stat-cell-value \{ display: flex; flex-wrap: wrap;/);
  });
  test("the folded empty-days row bleeds its hover with a shadow, not negative margins", () => {
    const rule = css.match(/\.ui-agenda-gap-head \{[^}]*\}/)![0];
    expect(rule).not.toContain("margin: 0 calc(-1");
    expect(css).toContain(".ui-agenda-gap-head:hover { background: var(--color-fill-tertiary); box-shadow: 0 0 0 var(--spacing-xs) var(--color-fill-tertiary); }");
  });
});

/** The list's dates live on the status chip (no Issued/Due columns): the
 *  tooltip must not be clipped, and touch screens get the text as a line. */
describe("Zinvoice status-chip dates", () => {
  test("the table no longer clips (tooltips), the chip shows a focus ring, and touch shows the note", () => {
    expect(css).toContain(".inv-table-card .table-wrap { overflow: visible; }");
    expect(css).toContain(".inv-status-chip:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }");
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.inv-status-note \{ display: block;/);
  });
});
