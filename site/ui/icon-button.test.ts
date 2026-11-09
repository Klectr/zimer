import { describe, expect, test } from "bun:test";
import { iconButton } from "./icon-button";

describe("iconButton", () => {
  test("renders an icon-only button with aria-label and tooltip title", () => {
    const html = iconButton({ icon: "edit", label: "Edit entry" });
    expect(html).toContain('class="ui-icon-btn"');
    expect(html).toContain('aria-label="Edit entry"');
    expect(html).toContain('title="Edit entry"');
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
});
