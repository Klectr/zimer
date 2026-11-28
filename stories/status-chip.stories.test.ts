import { describe, expect, test } from "bun:test";
import { statusChipStories } from "./status-chip.stories";

describe("status chip stories", () => {
  test("render without throwing and cover all three statuses", () => {
    const all = statusChipStories.map((s) => s.render()).join("");
    expect(all).toContain("ui-chip-draft");
    expect(all).toContain("ui-chip-sent");
    expect(all).toContain("ui-chip-paid");
  });
});
