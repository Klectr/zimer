import { describe, expect, test } from "bun:test";
import { timerHomeStories } from "./timer-home.stories";
import config from "../zandbox.config";

describe("zimer home stories", () => {
  test("cover idle, running, the today list, and its loading / empty / met states", () => {
    const all = timerHomeStories.map((s) => s.render()).join("");
    expect(all).toContain("Not tracking");
    expect(all).toContain('<datalist id="tk-desc-suggest">');
    expect(all).toContain('id="timer-worth" data-rate="120"');
    expect(all).toContain("window.__tkTick=setInterval(tick,1000)");
    expect(all).toContain('class="ui-target"');
    expect(all).toContain("ui-repeat-form");
    expect(all).toContain("ui-inv-mark");
    expect(all).toContain("skel-stack");
    expect(all).toContain("Nothing tracked today yet.");
    expect(all).toContain("Target met");
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of timerHomeStories) expect(ids).toContain(s.id);
  });
});
