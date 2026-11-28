import { describe, expect, test } from "bun:test";
import { calendarStories } from "./calendar.stories";

describe("calendar stories", () => {
  test("render without throwing and cover the calendar components", () => {
    const all = calendarStories.map((s) => s.render()).join("");
    expect(all).toContain("ui-week-grid");
    expect(all).toContain("ui-week-agenda");
    expect(all).toContain("ui-viz-block");
    expect(all).toContain("ui-viz-now");
  });
});
