/** #395: locked account-menu UI spec — regression guard.
 *
 *  Decision under test: the expressive account-menu spec in
 *  docs/design-system.md is canonical, and the shipped CSS is its reference
 *  implementation. This test parses site/static/style.css (rule-block
 *  regex + declaration checks — reformatting never false-fails) and asserts
 *  the locked values:
 *    .m3-menu      — 4px internal padding, 16px container radius
 *                      (via --md-sys-shape-corner-large)
 *    .m3-menu-item — 48dp height, 12px state-layer radius
 *                      (via --md-sys-shape-corner-medium)
 *    :root         — corner-large resolves to 16px, corner-medium to 12px
 *
 *  Red here means the change needs a GitHub issue and a spec update —
 *  never a silent restyle.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(
  join(import.meta.dir, "..", "static", "style.css"),
  "utf8",
);

/** Declaration block for a selector that starts a line (exact match). */
function ruleBlock(selector: string): string {
  const re = new RegExp(
    "^" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}",
    "m",
  );
  const m = css.match(re);
  if (!m) throw new Error(`locked-spec: selector not found: ${selector}`);
  return m[1];
}

/** "prop: value;" pairs out of a rule block (comments stripped). */
function declarations(block: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const part of block.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const i = part.indexOf(":");
    if (i === -1) continue;
    decls.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return decls;
}

/** Expand a padding shorthand to [top, right, bottom, left]. */
function paddingSides(value: string): string[] {
  const p = value.split(/\s+/).filter(Boolean);
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  if (p.length === 4) return p;
  throw new Error(`locked-spec: unexpected padding: ${value}`);
}

describe("account-menu locked spec (#395)", () => {
  test("16px/12px/4px values hold and the 16−4=12 geometry checks out", () => {
    const root = declarations(ruleBlock(":root"));
    expect(root.get("--md-sys-shape-corner-large")).toBe("16px");
    expect(root.get("--md-sys-shape-corner-medium")).toBe("12px");

    const menu = declarations(ruleBlock(".m3-menu"));
    const padding = menu.get("padding");
    expect(padding).toBeDefined();
    expect(paddingSides(padding!)).toEqual(["4px", "4px", "4px", "4px"]);
    expect(menu.get("border-radius")).toBe("var(--md-sys-shape-corner-large)");
    expect(menu.get("background")).toBe(
      "var(--md-sys-color-surface-container-high)",
    );

    const item = declarations(ruleBlock(".m3-menu-item"));
    expect(item.get("min-height")).toBe("48px");
    expect(item.get("border-radius")).toBe(
      "var(--md-sys-shape-corner-medium)",
    );

    // the geometry that makes the spec: the item state-layer radius must
    // equal the container radius minus the container inset
    const container = parseFloat(root.get("--md-sys-shape-corner-large")!);
    const inset = parseFloat(paddingSides(padding!)[0]);
    const inner = parseFloat(root.get("--md-sys-shape-corner-medium")!);
    expect(inner).toBe(container - inset);
  });
});
