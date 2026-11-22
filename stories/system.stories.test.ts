import { describe, expect, test } from "bun:test";
import { systemStories } from "./system.stories";
import config from "../zandbox.config";

describe("system stories", () => {
  test("cover every update outcome, the four error pages and the drawer", () => {
    const all = systemStories.map((s) => s.render()).join("");
    expect(all).toContain("status-row-primary");
    expect(all).toContain('status-row status-row-error" role="alert"');
    expect(all).toContain('class="update-cmd"');
    expect((all.match(/class="error-page"/g) || []).length).toBe(4);
    expect(all).toContain('class="error-mark"');
    expect(all).toContain('class="nav-drawer-row" href="#"');
    expect(all).toContain('<form method="POST" action="#" class="nav-drawer-logout">');
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of systemStories) expect(ids).toContain(s.id);
  });
});
