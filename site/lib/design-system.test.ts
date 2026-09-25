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

describe("navigation rail width (#397)", () => {
  test("72px rail — documented deviation from the M3 80dp default", () => {
    // :root is split across two blocks; take the one carrying the nav token
    const hits = [...css.matchAll(/^:root\s*\{([^}]*)\}/gm)];
    const hit = hits.find((m) => m[1].includes("--md-nav-rail-width"));
    if (!hit)
      throw new Error(
        "locked-spec: --md-nav-rail-width not found in any :root block",
      );
    const root = declarations(hit[1]);
    expect(root.get("--md-nav-rail-width")).toBe("72px");

    const rail = declarations(ruleBlock(".md-nav-rail"));
    expect(rail.get("width")).toBe("var(--md-nav-rail-width)");
  });
});

describe("update-check progress state (#406)", () => {
  test("spinner occupies the icon's 18px box; hands spin; reduced-motion is static", () => {
    // hidden at rest, same 18px box as the refresh icon it replaces
    const hidden = declarations(ruleBlock("#check-updates-btn .btn-spinner"));
    expect(hidden.get("display")).toBe("none");
    expect(hidden.get("width")).toBe("18px");
    expect(hidden.get("height")).toBe("18px");

    // shown while htmx has the request in flight; refresh icon hidden
    const shown = declarations(
      ruleBlock("#check-updates-btn.htmx-request .btn-spinner"),
    );
    expect(shown.get("display")).toBe("inline-flex");
    const iconHidden = declarations(
      ruleBlock("#check-updates-btn.htmx-request > svg"),
    );
    expect(iconHidden.get("display")).toBe("none");

    // the clock hands rotate around the clock center (33, 22 on the 64-grid)
    expect(css).toContain("@keyframes tk-logo-spin");
    expect(css).toContain("transform-origin: 33px 22px");

    // reduced motion: the logo still swaps in, but the hands stay still.
    // Matched directly — other components add their own reduce blocks (#511),
    // so no assumption about which @media block is first.
    expect(css).toContain(".tk-logo-spinning .tk-logo-hands { animation: none; }");
  });
});
