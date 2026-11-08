import { describe, expect, test } from "bun:test";
import { button } from "./button";

describe("button", () => {
  test("defaults to a filled submit-free button", () => {
    const html = button({ label: "Send Zinvoice" });
    expect(html).toContain('type="button"');
    expect(html).toContain('class="md-filled-button"');
    expect(html).toContain(">Send Zinvoice</button>");
  });

  test("maps variants to the app's button classes", () => {
    expect(button({ label: "A", variant: "tonal" })).toContain('class="md-tonal-button"');
    expect(button({ label: "A", variant: "text" })).toContain('class="md-text-button"');
  });

  test("danger adds the danger modifier on the text variant", () => {
    expect(button({ label: "Delete", variant: "text", danger: true })).toContain(
      'class="md-text-button danger"',
    );
  });

  test("danger throws on variants that have no danger styling", () => {
    expect(() => button({ label: "Delete", danger: true })).toThrow("danger");
    expect(() => button({ label: "Delete", variant: "tonal", danger: true })).toThrow("danger");
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
