import { describe, expect, test } from "bun:test";
import { cardStories } from "./card.stories";

describe("card stories", () => {
  test("render without throwing and use the ui-card markup", () => {
    const all = cardStories.map((s) => s.render()).join("");
    expect(all).toContain("ui-card");
    expect(all).toContain("ui-chip");
  });
});
