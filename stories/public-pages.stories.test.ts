import { describe, expect, test } from "bun:test";
import { publicPagesStories } from "./public-pages.stories";
import config from "../zandbox.config";

describe("public pages stories", () => {
  test("cover the product preview, both section variants, and the doc sections + footer", () => {
    const all = publicPagesStories.map((s) => s.render()).join("");
    expect(all).toContain('class="ui-landing-mini"');
    expect(all).toContain('class="ui-landing-section" id="story-features"');
    expect(all).toContain('class="ui-landing-pricing" id="story-pricing"');
    expect(all).toContain("ui-landing-offer");
    expect(all).toContain('class="changelog-release"');
    expect(all).toContain('<a href="#">a product analytics tool</a>');
    expect(all).toContain("Shared securely via Zimer · <a href=\"#\">Changelog</a>");
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of publicPagesStories) expect(ids).toContain(s.id);
  });
});
