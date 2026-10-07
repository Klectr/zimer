/** #654: the account menu is gone — Triston wanted its four actions (Settings,
 *  Export entries CSV, Download backup, Log out) visible as icons in the top
 *  app bar instead of two taps deep. The old #395 locked spec (menu geometry)
 *  is retired; the replacement lock is the .app-bar-actions row that carries
 *  the four .md-icon-buttons: inline-flex, 4px gap, never wrapping. The four
 *  buttons reuse the shared .md-icon-button (48dp, tooltips via data-tip).
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

describe("app-bar actions locked spec (#654)", () => {
  test("actions row is an inline-flex strip with a 4px gap; buttons are the shared 48dp icon buttons", () => {
    const row = declarations(ruleBlock(".app-bar-actions"));
    expect(row.get("display")).toBe("inline-flex");
    expect(row.get("gap")).toBe("4px");

    const btn = declarations(ruleBlock(".md-icon-button"));
    expect(btn.get("width")).toBe("48px");
    expect(btn.get("height")).toBe("48px");
    expect(btn.get("border-radius")).toBe("var(--md-sys-shape-corner-full)");
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

/** #841: the theme scheme has one source of truth — :root defines the short
 *  aliases once, the M3 primary tokens reference them, and no rule hardcodes
 *  the primary hexes. A scheme change is one edit in :root. */
describe("theme scheme single source of truth (#841)", () => {
  const rootBlock = (() => {
    const m = css.match(/:root\s*\{[^}]*\}/);
    if (!m) throw new Error("locked-spec: :root block not found");
    return m[0];
  })();
  const outsideRoot = css.replace(/:root\s*\{[^}]*\}/, "");

  test(":root defines the short theme aliases with the scheme hexes", () => {
    for (const [name, hex] of [
      ["--primary", "#fb923c"],
      ["--on-primary", "#442100"],
      ["--primary-container", "#713d00"],
      ["--on-primary-container", "#ffdcc2"],
    ]) {
      expect(rootBlock).toMatch(new RegExp(`${name}:\\s*${hex};`));
    }
  });

  test("the M3 primary tokens reference the short aliases", () => {
    for (const [token, alias] of [
      ["--md-sys-color-primary", "--primary"],
      ["--md-sys-color-on-primary", "--on-primary"],
      ["--md-sys-color-primary-container", "--primary-container"],
      ["--md-sys-color-on-primary-container", "--on-primary-container"],
    ]) {
      expect(rootBlock).toMatch(
        new RegExp(`${token}:\\s*var\\(${alias}\\);`),
      );
    }
  });

  test("no primary hex is hardcoded outside :root", () => {
    expect(outsideRoot).not.toMatch(/#fb923c/i);
    expect(outsideRoot).not.toMatch(/#f2c14e/i);
  });
});

/** #871: the label type scale is complete — large (14sp/20sp/0.1 tracking),
 *  medium (12sp/16sp/0.5), small (11sp/16sp/0.5), all weight 500. The small
 *  rule was referenced by the calendar agenda but never defined. */
describe("label type scale (#871)", () => {
  test("all three label rules exist with M3 spec values", () => {
    for (const [selector, size, lh, tracking] of [
      [".md-label-large", "0.875rem", "20px", "0.1px"],
      [".md-label-medium", "0.75rem", "16px", "0.5px"],
      [".md-label-small", "0.6875rem", "16px", "0.5px"],
    ]) {
      const rule = declarations(ruleBlock(selector));
      expect(rule.get("font-size")).toBe(size);
      expect(rule.get("line-height")).toBe(lh);
      expect(rule.get("font-weight")).toBe("500");
      expect(rule.get("letter-spacing")).toBe(tracking);
    }
  });
});

/** #873: changelog code spans never split mid-identifier — a hyphen-minus is
 *  a legal line-break point, so --var names in release notes could wrap after
 *  the dashes ("--" then "primary,"). The spans are short identifiers, so
 *  nowrap carries no overflow risk. */
describe("changelog code spans (#873)", () => {
  test("code spans are nowrap so identifiers stay on one line", () => {
    const rule = declarations(ruleBlock(".page-changelog code"));
    expect(rule.get("white-space")).toBe("nowrap");
  });
});
