import { describe, expect, test } from "bun:test";
import { feedbackStories } from "./feedback.stories";

describe("feedback stories", () => {
  test("render without throwing and cover the feedback components", () => {
    const all = feedbackStories.map((s) => s.render()).join("");
    expect(all).toContain("ui-dialog");
    expect(all).toContain("ui-toast");
    expect(all).toContain("ui-menu");
    expect(all).toContain("ui-empty");
  });
});
