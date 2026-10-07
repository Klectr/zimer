/** #884: accent theme — the app layout's <head> carries the theme override
 *  so the whole app re-themes without touching the stylesheet. */
import { describe, expect, test } from "bun:test";
import type { Statement } from "bun:sqlite";
import { themeCss, themeKey } from "../lib/theme.ts";
import { createLayoutViews } from "./layout.ts";

const noRunning = { get: () => null } as unknown as Statement;

describe("layout theme override (#884)", () => {
  test("the head carries the theme override after the stylesheet", () => {
    const { layout } = createLayoutViews(noRunning, () => themeCss(themeKey("crimson")));
    const head = layout("T", "body");
    const cssIdx = head.indexOf("/static/style.css");
    const styleIdx = head.indexOf('<style id="theme-style">');
    expect(cssIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeGreaterThan(cssIdx);
    expect(head).toContain("--primary:#ffb4a8");
  });
  test("default theme emits pumpkin values", () => {
    const { layout } = createLayoutViews(noRunning, () => themeCss(themeKey("")));
    expect(layout("T", "body")).toContain("--primary:#fb923c");
  });
  test("no getter (public 404 pages) still renders the empty tag", () => {
    const { layout } = createLayoutViews(noRunning);
    expect(layout("T", "body")).toContain('<style id="theme-style"></style>');
  });
});
