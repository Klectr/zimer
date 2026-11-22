import { describe, expect, test } from "bun:test";
import { clientsStories } from "./clients.stories";
import { formsStories } from "./forms.stories";
import config from "../zandbox.config";

describe("clients stories", () => {
  test("render without throwing and cover the table, tiers, empty state and hover card", () => {
    const all = clientsStories.map((s) => s.render()).join("");
    expect(all).toContain('class="ui-card manage-table-card"');
    expect(all).toContain('class="mg-row"');
    expect(all).toContain("mg-card");
    expect(all).toContain("Overdue");
    expect(all).toContain("No clients yet.");
    expect(all).toContain('document.addEventListener("pointermove"');
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of clientsStories) expect(ids).toContain(s.id);
  });
});

describe("settings row stories", () => {
  test("setting rows and data rows render through their components", () => {
    const all = formsStories.map((s) => s.render()).join("");
    expect(all).toContain('class="ui-setting-list"');
    expect(all).toContain('class="ui-data-list"');
    expect(all).toContain('class="ui-data-row"');
  });
});
