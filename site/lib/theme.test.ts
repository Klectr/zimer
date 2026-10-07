/** #884: theme key validation and :root override output. */
import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, THEMES, themeByKey, themeCss, themeKey } from "./theme.ts";

describe("themeKey", () => {
  test("accepts every known theme", () => {
    for (const t of THEMES) expect(themeKey(t.key)).toBe(t.key);
  });
  test("unknown, empty, and junk values degrade to the default", () => {
    expect(themeKey("hotpink")).toBe(DEFAULT_THEME);
    expect(themeKey("")).toBe(DEFAULT_THEME);
    expect(themeKey(null)).toBe(DEFAULT_THEME);
    expect(themeKey(undefined)).toBe(DEFAULT_THEME);
    expect(themeKey(42)).toBe(DEFAULT_THEME);
  });
  test("trims and lowercases", () => {
    expect(themeKey("  BLUE ")).toBe("blue");
  });
});

describe("themeByKey", () => {
  test("returns the def, defaulting on unknown keys", () => {
    expect(themeByKey("green").primary).toBe("#9be1a0");
    expect(themeByKey("nope").key).toBe(DEFAULT_THEME);
  });
});

describe("themeCss", () => {
  test("emits the full :root override for the theme", () => {
    const css = themeCss("crimson");
    expect(css).toContain(":root{");
    expect(css).toContain("--primary:#ffb4a8");
    expect(css).toContain("--on-primary:#690005");
    expect(css).toContain("--primary-container:#93000a");
    expect(css).toContain("--on-primary-container:#ffdad4");
  });
  test("the default theme is pumpkin", () => {
    const css = themeCss("");
    expect(css).toContain("--primary:#fb923c");
    expect(css).toContain("--on-primary:#442100");
  });
  test("every theme carries four distinct hex tones", () => {
    for (const t of THEMES) {
      const tones = [t.primary, t.onPrimary, t.container, t.onContainer];
      for (const tone of tones) expect(tone).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(tones).size).toBe(4);
    }
  });
});
