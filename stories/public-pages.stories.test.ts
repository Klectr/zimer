import { describe, expect, test } from "bun:test";
import { publicPagesStories } from "./public-pages.stories";
import config from "../zandbox.config";

describe("public pages stories", () => {
  test("cover the doc sections (plain and trusted-HTML) and the footer", () => {
    const all = publicPagesStories.map((s) => s.render()).join("");
    expect(all).toContain('class="changelog-release"');
    expect(all).toContain('<a href="#">a product analytics tool</a>');
    expect(all).toContain("Shared securely via Zimer · <a href=\"#\">Changelog</a>");
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of publicPagesStories) expect(ids).toContain(s.id);
  });
});
