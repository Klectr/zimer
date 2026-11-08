import { describe, expect, test } from "bun:test";
import { parseDesignTokens } from "./design-tokens";

const MD = `---
version: alpha
colors:
  colorPrimary: "#fb923c"
  # brand palette note
  colorBgLayout: "#08090a"
  colorFill: "rgba(255, 255, 255, 0.10)"
  colorInfo: #60a5fa
typography:
  fontSize: 14
---
# Body
`;

describe("parseDesignTokens", () => {
  test("reads quoted, unquoted, and rgba color values", () => {
    const tokens = parseDesignTokens(MD);
    expect(tokens).toContainEqual(["colorPrimary", "#fb923c"]);
    expect(tokens).toContainEqual(["colorFill", "rgba(255, 255, 255, 0.10)"]);
    expect(tokens).toContainEqual(["colorInfo", "#60a5fa"]);
  });

  test("a comment inside the colors block does not end parsing", () => {
    const names = parseDesignTokens(MD).map(([n]) => n);
    expect(names).toContain("colorBgLayout");
    expect(names.indexOf("colorBgLayout")).toBeGreaterThan(names.indexOf("colorPrimary"));
  });

  test("stops at the next top-level key", () => {
    const names = parseDesignTokens(MD).map(([n]) => n);
    expect(names).not.toContain("fontSize");
  });

  test("rejects values that are not plain colors", () => {
    const bad = MD.replace('"#fb923c"', '"red;position:fixed"');
    expect(() => parseDesignTokens(bad)).toThrow("colorPrimary");
  });

  test("throws when frontmatter is missing", () => {
    expect(() => parseDesignTokens("# No frontmatter\n")).toThrow("frontmatter");
  });

  test("throws when no color tokens parse", () => {
    expect(() => parseDesignTokens("---\nversion: alpha\n---\n")).toThrow("no color tokens");
  });
});
