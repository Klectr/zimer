import { describe, expect, test } from "bun:test";
import { fieldStories } from "./field.stories";

describe("field stories", () => {
  test("render without throwing and use the ui field markup", () => {
    const all = fieldStories.map((s) => s.render()).join("");
    expect(all).toContain("ui-field");
    expect(all).toContain("ui-input");
    expect(all).toContain("ui-select");
  });
});
