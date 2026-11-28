import { describe, expect, test } from "bun:test";
import { icon } from "../lib/icons";
import { iconButton } from "./icon-button";

describe("iconButton", () => {
  test("renders an icon-only button with aria-label and the house data-tip tooltip, never a native title (#1103)", () => {
    const html = iconButton({ icon: "edit", label: "Edit entry" });
    expect(html).toContain('class="ui-icon-btn"');
    expect(html).toContain('aria-label="Edit entry"');
    expect(html).toContain('data-tip="Edit entry"');
    expect(html).not.toContain('title="Edit entry"');
    expect(html).toContain("<svg");
  });

  test("danger and disabled modifiers", () => {
    expect(iconButton({ icon: "delete", label: "Delete", danger: true })).toContain("ui-icon-btn-danger");
    expect(iconButton({ icon: "edit", label: "Edit", disabled: true })).toContain(" disabled");
  });

  test("label is escaped in both attributes", () => {
    const html = iconButton({ icon: "edit", label: 'Say "hi" <now>' });
    expect(html).not.toContain('Say "hi"');
    expect(html).toContain("&quot;hi&quot;");
  });

  test("default output shape is byte-stable", () => {
    expect(iconButton({ icon: "edit", label: "Edit entry" })).toBe(
      `<button type="button" class="ui-icon-btn" aria-label="Edit entry" data-tip="Edit entry">${icon("edit")}</button>`,
    );
  });

  test("tip overrides the tooltip text without touching the aria-label", () => {
    const html = iconButton({ icon: "edit", label: "Edit entry", tip: "Edit" });
    expect(html).toContain('aria-label="Edit entry"');
    expect(html).toContain('data-tip="Edit"');
  });

  test("tip: null omits the data-tip attribute entirely", () => {
    const html = iconButton({ icon: "close", label: "Close dialog", tip: null });
    expect(html).not.toContain("data-tip");
    expect(html).toContain('aria-label="Close dialog"');
  });

  test("className appends after the danger modifier", () => {
    const html = iconButton({ icon: "delete", label: "Delete draft", danger: true, className: "tip-right" });
    expect(html).toContain('class="ui-icon-btn ui-icon-btn-danger tip-right"');
  });
});
