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

describe("inline alert story", () => {
  test("shows all three tones; warning and error are announced", async () => {
    const { feedbackStories } = await import("./feedback.stories");
    const html = feedbackStories.find((s) => s.id === "feedback-inline-alert")!.render();
    expect(html).toContain('class="ui-alert ui-alert-info" role="status"');
    expect(html).toContain('class="ui-alert ui-alert-warning" role="alert"');
    expect(html).toContain('class="ui-alert ui-alert-error" role="alert"');
    expect(html).toContain("Set business name");
  });
});
