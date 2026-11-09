import { describe, expect, test } from "bun:test";
import { tag } from "./tag";
import { timerDisplay, timerPanel } from "./timer-display";
import { extensionPopup } from "./extension-popup";
import { publicInvoice } from "./public-invoice";
import { changelogList } from "./changelog";
import { heroSection, featureCard } from "./landing";

describe("tag", () => {
  test("tones map to tint classes; dot renders only when asked", () => {
    expect(tag({ label: "Running", tone: "success", dot: true })).toContain("ui-tag-success");
    expect(tag({ label: "Running", tone: "success", dot: true })).toContain("ui-tag-dot");
    expect(tag({ label: "Plain" })).toContain("ui-tag-neutral");
    expect(tag({ label: "Plain" })).not.toContain("ui-tag-dot");
  });

  test("labels are escaped", () => {
    expect(tag({ label: "<b>x</b>" })).not.toContain("<b>x</b>");
  });
});

describe("timer display + panel", () => {
  test("live display carries the real data-start contract; small size uses the sm class", () => {
    expect(timerDisplay({ elapsed: "01:00:00", start: "2026-11-08T09:04:00" })).toContain('data-start="2026-11-08T09:04:00"');
    expect(timerDisplay({ elapsed: "01:00:00", size: "sm" })).toContain("ui-timer-sm");
    expect(timerDisplay({ elapsed: "01:00:00" })).not.toContain("data-start");
  });

  test("running panel tracks (primary tint); idle panel does not", () => {
    const running = timerPanel({ running: true, statusHtml: "S", context: "C", elapsed: "00:01:00", startedAt: "2026-11-08T09:04:00", actionsHtml: "A" });
    const idle = timerPanel({ running: false, statusHtml: "S", context: "C", elapsed: "00:00:00", actionsHtml: "A" });
    expect(running).toContain("ui-card tracking");
    expect(idle).not.toContain("tracking");
    expect(running).toContain('data-start="2026-11-08T09:04:00"');
    expect(idle).not.toContain("data-start");
  });
});

describe("extension popup", () => {
  test("renders logo head, body, and footer sections", () => {
    const html = extensionPopup({ statusHtml: "ST", bodyHtml: "B", footerHtml: "F" });
    expect(html).toContain("ui-ext");
    expect(html).toContain("ui-ext-footer");
    expect(html).toContain("Zimer");
  });
});

describe("public invoice", () => {
  test("renders business, lines, total, and the pay action; escapes text", () => {
    const html = publicInvoice({
      business: "Studio <b>X</b>",
      meta: "Zinvoice #1041 · Issued Nov 5, 2026",
      lines: [{ label: "Work — 9.5h", amount: "$902.50" }],
      totalLabel: "Total due",
      total: "$902.50",
      pay: { label: "Pay $902.50", href: "https://pay.example/i/abc" },
      footer: "Powered by Zimer",
    });
    expect(html).toContain("ui-public-sheet");
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("Pay $902.50");
    expect(html).toContain('href="https://pay.example/i/abc"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain("Powered by Zimer");
  });
});

describe("public invoice pay action", () => {
  test("no pay link, no pay button (paid or linkless Zinvoices)", () => {
    const html = publicInvoice({ business: "B", meta: "M", lines: [], totalLabel: "Total due", total: "$0.00" });
    expect(html).not.toContain("ui-btn-primary");
  });
});

describe("changelog", () => {
  test("kinds map to their tags; empty list says so", () => {
    const html = changelogList([
      { date: "Nov 6, 2026", kind: "fix", body: "Fixed it." },
      { date: "Nov 2, 2026", kind: "new", body: "Added it." },
      { date: "Oct 20, 2026", kind: "improved", body: "Better." },
    ]);
    expect(html).toContain(">Fix<");
    expect(html).toContain(">New<");
    expect(html).toContain(">Improved<");
    expect(changelogList([])).toContain("Nothing shipped yet.");
  });
});

describe("landing sections", () => {
  test("hero composes tag, title, sub, actions, note, and product slot", () => {
    const html = heroSection({ tagLine: "T", title: "Your Zimer is your Zinvoice.", sub: "S", actionsHtml: "A", note: "N", productHtml: "P" });
    expect(html).toContain("ui-hero-title");
    expect(html).toContain("ui-hero-product");
    expect(html).toContain("Your Zimer is your Zinvoice.");
  });

  test("feature card renders icon, title, and body in a card", () => {
    const html = featureCard({ icon: "timer", title: "One job", body: "Done well." });
    expect(html).toContain("ui-feature");
    expect(html).toContain("<svg");
    expect(html).toContain("Done well.");
  });
});

describe("timerPanel ids (#1102)", () => {
  test("card id and elapsed id forward to the tick script hooks", () => {
    const html = timerPanel({ id: "timer-card", elapsedId: "elapsed", running: true, statusHtml: "<span>Running</span>", context: "Acme", elapsed: "…", startedAt: "2026-11-08T09:04:00", actionsHtml: "<button>Stop</button>" });
    expect(html).toContain('id="timer-card"');
    expect(html).toContain('id="elapsed"');
    expect(html).toContain('data-start="2026-11-08T09:04:00"');
  });
});

describe("timerPanel started line (#1121)", () => {
  test("startedAt without a label renders a client-formatted Started time", () => {
    const html = timerPanel({ running: true, statusHtml: "S", context: "C", elapsed: "…", startedAt: "2026-11-08T09:04:00", actionsHtml: "A" });
    expect(html).toContain('Started <time data-ts="2026-11-08T09:04:00"></time>');
  });
  test("an explicit label wins over the startedAt line", () => {
    const html = timerPanel({ running: true, statusHtml: "S", context: "C", elapsed: "…", startedLabel: "Started 9:04 AM", startedAt: "2026-11-08T09:04:00", actionsHtml: "A" });
    expect(html).toContain("Started 9:04 AM");
    expect(html).not.toContain("<time data-ts=");
  });
});
