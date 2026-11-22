import { describe, expect, test } from "bun:test";
import { calendarPaneStories } from "./calendar-pane.stories";
import config from "../zandbox.config";

describe("calendar pane stories", () => {
  test("cover nav, delta up/down, nudge with and without amount, target over, clients, first run, legend", () => {
    const all = calendarPaneStories.map((s) => s.render()).join("");
    expect(all).toContain('class="week-nav"');
    expect(all).toContain(">Today</a>");
    expect(all).toContain("12% up vs this time last week");
    expect(all).toContain("8% down vs prev week");
    expect(all).toContain("nudge-chip--solo");
    expect(all).toContain("not yet Zinvoiced");
    expect(all).toContain("over target");
    expect(all).toContain('class="week-client"');
    expect(all).toContain("cal-first-run");
    expect(all).toContain("Export week CSV");
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of calendarPaneStories) expect(ids).toContain(s.id);
  });
});
