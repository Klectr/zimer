import { describe, expect, test } from "bun:test";
import { dataStories } from "./data.stories";

describe("data stories", () => {
  test("render without throwing and cover the data components", () => {
    const all = dataStories.map((s) => s.render()).join("");
    expect(all).toContain("ui-stat-value");
    expect(all).toContain("ui-progress");
    expect(all).toContain("ui-steps");
    expect(all).toContain("ui-row");
    expect(all).toContain("ui-table");
  });
});
