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

  test("every dialog story ships a trigger and the close wiring", () => {
    const dialogStories = feedbackStories.filter((s) => s.id.startsWith("feedback-dialog"));
    for (const story of dialogStories) {
      const html = story.render();
      expect(html).toContain("data-open-dialog");
      expect(html).toContain("__zbDialogDemo");
      expect(html).toContain("data-close");
    }
  });
});
