import { describe, expect, test } from "bun:test";
import { button } from "./button";

describe("button", () => {
  test("defaults to the default (surface) variant, submit-free", () => {
    const html = button({ label: "Save draft" });
    expect(html).toContain('type="button"');
    expect(html).toContain('class="ui-btn"');
    expect(html).toContain(">Save draft</button>");
  });

  test("maps variants to the ui button classes", () => {
    expect(button({ label: "A", variant: "primary" })).toContain('class="ui-btn ui-btn-primary"');
    expect(button({ label: "A", variant: "ghost" })).toContain('class="ui-btn ui-btn-ghost"');
  });

  test("danger is styled on every variant (solid error on primary)", () => {
    expect(button({ label: "Delete", danger: true })).toContain('class="ui-btn ui-btn-danger"');
    expect(button({ label: "Delete", variant: "ghost", danger: true })).toContain(
      'class="ui-btn ui-btn-ghost ui-btn-danger"',
    );
    expect(button({ label: "Delete", variant: "primary", danger: true })).toContain(
      'class="ui-btn ui-btn-primary ui-btn-danger"',
    );
  });

  test("sizes add the size class; md is the unclassed default", () => {
    expect(button({ label: "A", size: "sm" })).toContain('class="ui-btn ui-btn-sm"');
    expect(button({ label: "A", size: "lg" })).toContain('class="ui-btn ui-btn-lg"');
    expect(button({ label: "A", size: "md" })).toContain('class="ui-btn"');
  });

  test("disabled renders the disabled attribute", () => {
    expect(button({ label: "A", disabled: true })).toContain(" disabled>");
  });

  test("submit type is available for forms", () => {
    expect(button({ label: "Save", type: "submit" })).toContain('type="submit"');
  });

  test("label is escaped", () => {
    const html = button({ label: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
