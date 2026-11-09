import { describe, expect, test } from "bun:test";
import { shellStories } from "./shell.stories";
import { iconButtonStories } from "./icon-button.stories";

describe("shell stories", () => {
  test("render without throwing and use the shell markup", () => {
    const all = shellStories.map((s) => s.render()).join("");
    expect(all).toContain("ui-side");
    expect(all).toContain("ui-navitem");
    expect(all).toContain("ui-app-head");
    expect(all).toContain("ui-tab");
    expect(all).toContain("ui-logo");
    expect(all).toContain("ui-running");
    expect(all).toContain("ui-side-foot");
  });
});

describe("icon button stories", () => {
  test("render without throwing and use the icon button markup", () => {
    const all = iconButtonStories.map((s) => s.render()).join("");
    expect(all).toContain("ui-icon-btn");
    expect(all).toContain("ui-icon-btn-danger");
  });
});
