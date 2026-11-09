import { describe, expect, test } from "bun:test";
import { checkboxField, switchField, settingRow } from "./choice";
import { authCard } from "./auth-card";
import { settingsSection } from "./settings-section";
import { planCard } from "./plan-card";
import { formSection, unbilledTable, invoiceSummary } from "./zinvoice-form";
import { button } from "./button";

describe("choice fields", () => {
  test("checkbox renders checked state, name/value, and hint", () => {
    const html = checkboxField({ id: "c1", label: "Billable", name: "b", value: "1", hint: "Default on.", checked: true });
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(" checked");
    expect(html).toContain('name="b"');
    expect(html).toContain('value="1"');
    expect(html).toContain("ui-choice-hint");
  });

  test("bare checkbox drops the visible text and names the input for AT", () => {
    const html = checkboxField({ id: "c2", label: "Include entry", bare: true, checked: true });
    expect(html).toContain('aria-label="Include entry"');
    expect(html).not.toContain("ui-choice-label");
  });

  test("switch carries role=switch and checked state", () => {
    const html = switchField({ id: "s1", label: "Weekends", checked: true });
    expect(html).toContain('role="switch"');
    expect(html).toContain(" checked");
    expect(html).toContain("ui-switch");
  });

  test("labels are escaped", () => {
    expect(checkboxField({ id: "c3", label: "<img src=x>" })).not.toContain("<img src=x>");
  });

  test("setting row renders title, hint, and the control slot", () => {
    const html = settingRow({ title: "Weekend days", hint: "Faded.", controlHtml: "<b>ctl</b>" });
    expect(html).toContain("ui-setting-row");
    expect(html).toContain("Weekend days");
    expect(html).toContain("<b>ctl</b>");
  });
});

describe("auth card", () => {
  test("composes logo, title, fields, submit, footer, and note", () => {
    const html = authCard({
      action: "/login",
      title: "Welcome back",
      sub: "Log in.",
      fieldsHtml: "<input>",
      submitLabel: "Log in",
      footerHtml: "<span>New here?</span>",
      note: "Self-hosting note.",
    });
    expect(html).toContain("ui-auth-card");
    expect(html).toContain('action="/login"');
    expect(html).toContain("Welcome back");
    expect(html).toContain('type="submit"');
    expect(html).toContain("ui-btn-block");
    expect(html).toContain("Self-hosting note.");
  });

  test("an error renders as an alert between the sub and the form, escaped", () => {
    const html = authCard({ action: "/login", title: "T", sub: "S", fieldsHtml: "", submitLabel: "Log in", error: "Wrong <token>." });
    expect(html).toContain('<p class="error" role="alert">Wrong &lt;token&gt;.</p>');
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf("<form"));
    const clean = authCard({ action: "/login", title: "T", sub: "S", fieldsHtml: "", submitLabel: "Log in" });
    expect(clean).not.toContain('role="alert"');
  });

  test("submit label is a verb phrase rendered through button()", () => {
    const html = authCard({ action: "/signup", title: "T", sub: "S", fieldsHtml: "", submitLabel: "Create account" });
    expect(html).toContain("Create account");
    expect(html).toContain("ui-btn-primary");
  });
});

describe("settings section + plan card", () => {
  test("section renders title, hint, body, and actions inside a card", () => {
    const html = settingsSection({ title: "Profile", hint: "H", bodyHtml: "<p>B</p>", actionsHtml: "<p>A</p>" });
    expect(html).toContain("ui-card");
    expect(html).toContain("ui-section-title");
    expect(html).toContain("ui-section-actions");
  });

  test("current plan gets the chip and primary border class; features render checks", () => {
    const html = planCard({ name: "Hosted", amount: "$12", period: "/ month", features: ["Backups"], ctaHtml: button({ label: "Manage subscription" }), current: true });
    expect(html).toContain("is-current");
    expect(html).toContain("Current plan");
    expect(html).toContain("ui-plan-chip");
    expect(html).not.toContain("ui-chip-paid");
    expect(html).toContain("Backups");
    expect(html).toContain("<svg");
  });

  test("non-current plan has no chip", () => {
    const html = planCard({ name: "Self-host", amount: "$0", features: [], ctaHtml: "" });
    expect(html).not.toContain("Current plan");
    expect(html).toContain('<span class="ui-card-head-end"></span>');
  });

  test("statusHtml renders in the card head end", () => {
    const html = planCard({ name: "Hosted", amount: "$12", features: [], ctaHtml: "", statusHtml: '<span class="ui-tag ui-tag-success">Active</span>' });
    expect(html).toContain('<span class="ui-card-head-end"><span class="ui-tag ui-tag-success">Active</span></span>');
  });

  test("bare renders the plan without the card chrome", () => {
    const html = planCard({ name: "Hosted", amount: "$12", features: [], ctaHtml: "", bare: true });
    expect(html.startsWith('<div class="ui-plan">')).toBe(true);
    expect(html).not.toContain('class="ui-card"');
    expect(html).not.toContain('<div class="ui-card ui-plan">');
    expect(html).toContain('<span class="ui-section-title">Hosted</span>');
  });

  test("nameless with statusHtml renders a head row holding only the head end", () => {
    const html = planCard({ amount: "$12", features: [], ctaHtml: "", statusHtml: '<span class="ui-tag ui-tag-success">Active</span>' });
    expect(html).toContain('<div class="ui-card-head"><span class="ui-card-head-end"><span class="ui-tag ui-tag-success">Active</span></span></div>');
    expect(html).not.toContain("ui-section-title");
  });

  test("nameless without head content renders no head row", () => {
    const html = planCard({ amount: "$12", features: [], ctaHtml: "" });
    expect(html).not.toContain("ui-card-head");
    expect(html).not.toContain("ui-section-title");
    expect(html.startsWith('<div class="ui-card ui-plan"><div class="ui-plan-price">')).toBe(true);
  });
});

describe("zinvoice form pieces", () => {
  test("form section numbers its step", () => {
    expect(formSection({ step: 2, title: "Unbilled time", bodyHtml: "<p>x</p>" })).toContain("2 · Unbilled time");
  });

  test("unbilled table checks included entries and escapes labels", () => {
    const html = unbilledTable([
      { id: "e1", label: "Design <b>pass</b>", hours: "12.5h", amount: "$1,062.50", included: true },
      { id: "e2", label: "Planning", hours: "0.7h", amount: "$0.00", included: false },
    ]);
    expect(html).toContain('id="ub-e1"');
    expect(html).toContain('aria-label="Design &lt;b&gt;pass&lt;/b&gt;"');
    expect(html).toContain("<td>Design &lt;b&gt;pass&lt;/b&gt;</td>");
    expect(html).toContain(" checked");
    expect(html).not.toContain("<b>pass</b>");
    expect(html).toContain("$1,062.50");
  });

  test("empty unbilled table says so", () => {
    expect(unbilledTable([])).toContain("No unbilled time");
  });

  test("summary renders lines, total, and the body slot", () => {
    const html = invoiceSummary({
      title: "Live preview — #1042",
      lines: [{ label: "Design — 12.5h", amount: "$1,062.50" }],
      totalLabel: "Total due",
      total: "$1,062.50",
      bodyHtml: "<p>due field</p>",
    });
    expect(html).toContain("ui-summary-total");
    expect(html).toContain("due field");
  });

  test("button block option adds the block class", () => {
    expect(button({ label: "Save draft", block: true })).toContain("ui-btn-block");
  });
});

describe("settingsSection id", () => {
  test("id lands on the card root so htmx can target the section", () => {
    const html = settingsSection({ title: "Theme", bodyHtml: "<p>x</p>", id: "theme-section" });
    expect(html).toContain('id="theme-section"');
    expect(settingsSection({ title: "Theme", bodyHtml: "<p>x</p>" })).not.toContain('id="theme-section"');
  });
});
