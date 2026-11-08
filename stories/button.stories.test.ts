import { describe, expect, test } from "bun:test";
import { buttonStories } from "./button.stories";

describe("button stories", () => {
  test("render without throwing and cover the variants", () => {
    expect(buttonStories.length).toBeGreaterThanOrEqual(3);
    const all = buttonStories.map((s) => s.render()).join("");
    expect(all).toContain("md-filled-button");
    expect(all).toContain("md-tonal-button");
    expect(all).toContain("md-text-button");
  });
});
