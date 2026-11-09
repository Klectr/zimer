import { describe, expect, test } from "bun:test";
import { pagesStories } from "./pages.stories";

const MARKERS: Record<string, string> = {
  "page-landing": "Your Zimer is your Zinvoice.",
  "page-login": "ui-auth-card",
  "page-timer": "Today's entries",
  "page-calendar": "ui-week",
  "page-zinvoices": "Zinvoice #1040",
  "page-new-zinvoice": "Unbilled time",
  "page-zinvoice-detail": "Time breakdown total",
  "page-public": "ui-public-sheet",
  "page-manage": "Add a client",
  "page-settings": "Business profile",
  "page-extension": "ui-ext",
  "page-changelog": "What's new in Zimer",
};

describe("page stories", () => {
  test("all 12 screens exist", () => {
    expect(pagesStories.length).toBe(12);
    for (const id of Object.keys(MARKERS)) {
      expect(pagesStories.some((s) => s.id === id)).toBe(true);
    }
  });

  test("every page renders its marker without throwing", () => {
    for (const story of pagesStories) {
      const html = story.render();
      expect(html.length).toBeGreaterThan(200);
      expect(html).toContain(MARKERS[story.id]);
    }
  });

  test("app pages sit inside the shell (sidebar + header)", () => {
    for (const id of ["page-timer", "page-calendar", "page-zinvoices", "page-new-zinvoice", "page-zinvoice-detail", "page-manage", "page-settings"]) {
      const story = pagesStories.find((s) => s.id === id)!;
      const html = story.render();
      expect(html).toContain("ui-side");
      expect(html).toContain("ui-app-head");
    }
  });

  test("no page uses the banned ambient glow or a looping animation", () => {
    for (const story of pagesStories) {
      const html = story.render();
      expect(html).not.toContain("radial-gradient");
      expect(html).not.toContain("animation:");
    }
  });
});
