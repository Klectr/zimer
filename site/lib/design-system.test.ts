/** #654: the account menu is gone — Triston wanted its four actions (Settings,
 *  Export entries CSV, Download backup, Log out) visible as icons instead of
 *  two taps deep. The old #395 locked spec (menu geometry) is retired; the
 *  lock is now the .ui-shell-actions row in the sidebar footer (#1119) that
 *  carries the four ui icon buttons: flex, 4px gap, on the shared
 *  .ui-icon-button (36px control height, tooltips via data-tip).
 *
 *  Red here means the change needs a GitHub issue and a spec update —
 *  never a silent restyle.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { themeCss } from "./theme.ts";

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

describe("shell actions locked spec (#654)", () => {
  test("actions row is a flex strip with a 4px gap; buttons are the shared ui icon buttons", () => {
    const row = declarations(ruleBlock(".ui-shell-actions"));
    expect(row.get("display")).toBe("flex");
    expect(row.get("gap")).toBe("4px");

    const btn = declarations(ruleBlock(".ui-icon-btn"));
    expect(btn.get("width")).toBe("var(--control-height)");
    expect(btn.get("height")).toBe("var(--control-height)");
    expect(btn.get("border-radius")).toBe("var(--radius)");
  });
});

describe("zinvoices detail layout (#1202)", () => {
  test("the detail grid collapses to one column on narrow screens", () => {
    expect(css).toContain("@media (max-width: 1023px) {\n  .inv-new-grid, .inv-detail-grid { grid-template-columns: minmax(0, 1fr); }\n}");
  });

  test("the retired two-pane stat-hiding rule is gone with the pane", () => {
    expect(css).not.toContain("invoice-list-detail");
  });
});

describe("ui button anchors (#1121)", () => {
  test("link buttons never render with the UA underline", () => {
    const btn = declarations(ruleBlock(".ui-btn"));
    expect(btn.get("text-decoration")).toBe("none");
  });
});

describe("sidebar width (#1119)", () => {
  test("the mocked sidebar is 208px on the translucent panel surface", () => {
    const side = declarations(ruleBlock(".ui-side"));
    expect(side.get("width")).toBe("208px");
    expect(side.get("background")).toBe("var(--color-fill-quaternary)");
  });

  test("sidebar footer tooltips open upward, inside the viewport", () => {
    expect(css).toContain(".ui-side-foot .ui-icon-btn[data-tip]::before");
    const decls = declarations(ruleBlock(".ui-side-foot .ui-btn[data-tip]::before, .ui-side-foot .ui-icon-btn[data-tip]::before"));
    expect(decls.get("top")).toBe("auto");
    expect(decls.get("bottom")).toBe("calc(100% + var(--spacing-xs))");
    expect(decls.get("left")).toBe("0");
  });

  test("the trial banner never prints", () => {
    expect(css).toMatch(/@media print\s*\{\s*[^}]*\.trial-banner[^}]*display: none !important/);
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
 *  aliases once, the semantic --color-primary token references the primary
 *  alias, themeCss overrides the alias family per theme, and no rule
 *  hardcodes the primary hexes. A scheme change is one edit in :root. */
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

  test("style.css defines no legacy system tokens", () => {
    expect(css).not.toMatch(/--md[-]sys[-]/);
  });

  test("--color-primary references the short --primary alias", () => {
    expect(css).toMatch(/--color-primary:\s*var\(--primary\);/);
  });

  test("themeCss overrides the --primary family per theme", () => {
    const out = themeCss("crimson");
    for (const name of [
      "--primary",
      "--on-primary",
      "--primary-container",
      "--on-primary-container",
    ]) {
      expect(out).toContain(`${name}:`);
    }
    expect(out).not.toContain("#fb923c");
  });

  test("no primary hex is hardcoded outside :root", () => {
    expect(outsideRoot).not.toMatch(/#fb923c/i);
    expect(outsideRoot).not.toMatch(/#f2c14e/i);
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

describe("DESIGN.md token layer (#1092)", () => {
  function rootTokens(): Map<string, string> {
    const merged = new Map<string, string>();
    for (const block of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
      for (const [name, value] of declarations(block[1])) merged.set(name, value);
    }
    return merged;
  }

  test("every semantic token is defined with its DESIGN.md value", () => {
    const tokens = rootTokens();
    const expected: Record<string, string> = {
      "--color-primary": "var(--primary)",
      "--color-success": "#34d399",
      "--color-warning": "#fbbf24",
      "--color-error": "#f87171",
      "--color-info": "#60a5fa",
      "--color-text": "#f5f5f4",
      "--color-text-secondary": "#a1a1aa",
      "--color-text-tertiary": "#71717a",
      "--color-text-quaternary": "#52525b",
      "--color-bg-layout": "#08090a",
      "--color-bg-container": "#0d0d0f",
      "--color-bg-container-secondary": "#0a0b0c",
      "--color-bg-elevated": "#16171a",
      "--color-primary-bg": "color-mix(in srgb, var(--color-primary) 16%, transparent)",
      "--color-success-bg": "color-mix(in srgb, var(--color-success) 16%, transparent)",
      "--color-warning-bg": "color-mix(in srgb, var(--color-warning) 16%, transparent)",
      "--color-error-bg": "color-mix(in srgb, var(--color-error) 16%, transparent)",
      "--color-info-bg": "color-mix(in srgb, var(--color-info) 16%, transparent)",
      "--color-primary-hover": "color-mix(in srgb, var(--color-primary) 85%, white)",
      "--color-primary-active": "color-mix(in srgb, var(--color-primary) 85%, black)",
      "--color-primary-border": "color-mix(in srgb, var(--color-primary) 45%, transparent)",
      "--color-error-hover": "color-mix(in srgb, var(--color-error) 85%, white)",
      "--color-error-active": "color-mix(in srgb, var(--color-error) 85%, black)",
      "--color-error-border": "color-mix(in srgb, var(--color-error) 45%, transparent)",
      "--color-error-bg-hover": "color-mix(in srgb, var(--color-error) 24%, transparent)",
      "--color-success-hover": "color-mix(in srgb, var(--color-success) 85%, white)",
      "--color-success-active": "color-mix(in srgb, var(--color-success) 85%, black)",
      "--color-success-border": "color-mix(in srgb, var(--color-success) 45%, transparent)",
      "--color-warning-hover": "color-mix(in srgb, var(--color-warning) 85%, white)",
      "--color-warning-active": "color-mix(in srgb, var(--color-warning) 85%, black)",
      "--color-warning-border": "color-mix(in srgb, var(--color-warning) 45%, transparent)",
      "--color-info-hover": "color-mix(in srgb, var(--color-info) 85%, white)",
      "--color-info-active": "color-mix(in srgb, var(--color-info) 85%, black)",
      "--color-info-border": "color-mix(in srgb, var(--color-info) 45%, transparent)",
      "--color-bg-spotlight": "#1e1f23",
      "--color-border": "rgba(255, 255, 255, 0.14)",
      "--color-border-secondary": "rgba(255, 255, 255, 0.08)",
      "--color-fill": "rgba(255, 255, 255, 0.10)",
      "--color-fill-secondary": "rgba(255, 255, 255, 0.06)",
      "--color-fill-tertiary": "rgba(255, 255, 255, 0.04)",
      "--color-fill-quaternary": "rgba(255, 255, 255, 0.02)",
      "--font-size-sm": "12px",
      "--font-size": "14px",
      "--font-size-lg": "16px",
      "--font-size-xl": "20px",
      "--font-size-heading-1": "38px",
      "--font-size-heading-2": "30px",
      "--font-size-heading-3": "24px",
      "--font-size-heading-4": "20px",
      "--font-size-heading-5": "16px",
      "--font-weight-strong": "600",
      "--spacing-xxs": "4px",
      "--spacing-xs": "8px",
      "--spacing-sm": "12px",
      "--spacing": "16px",
      "--spacing-md": "20px",
      "--spacing-lg": "24px",
      "--spacing-xl": "32px",
      "--radius-xs": "4px",
      "--radius-sm": "6px",
      "--radius": "8px",
      "--radius-lg": "14px",
      "--radius-xl": "20px",
      "--control-height-sm": "28px",
      "--control-height": "36px",
      "--control-height-lg": "40px",
      "--line-height": "1.5714",
      "--line-height-sm": "1.6667",
      "--box-shadow-tertiary": "0 3px 1px -1px rgba(26, 26, 26, 0.06)",
      "--box-shadow-secondary": "0 8px 16px -4px rgba(0, 0, 0, 0.2)",
      "--box-shadow": "0 20px 20px -8px rgba(0, 0, 0, 0.24)",
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(tokens.get(name)).toBe(value);
    }
    expect(tokens.get("--font-family")).toContain("Geist");
    expect(tokens.get("--font-family-code")).toContain("Geist Mono");
  });

  test("the layer is complete: no DESIGN.md color is missing from the pins", () => {
    const tokens = rootTokens();
    const colorNames = [...tokens.keys()].filter((k) => k.startsWith("--color-"));
    expect(colorNames.length).toBe(41);
  });
});

describe("new-zinvoice layout (#1202 parity)", () => {
  test("the create form is not capped at the 480px edit-form width", () => {
    expect(css).toContain(".form.inv-new-form { max-width: none; }");
  });
  test("client, period, and rate share one row on wide cards and 2-up below 1280", () => {
    expect(css).toContain(".inv-step1-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.5fr) minmax(0, .8fr);");
    expect(css).toContain("@media (max-width: 1279px) {\n  .inv-step1-grid { grid-template-columns: 1fr 1fr; }");
  });
});

describe("settings layout (#1202 parity)", () => {
  test("the page is two balanced columns, one column inside the modal", () => {
    expect(css).toContain(".ui-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toContain(".settings-dialog .ui-settings-grid { grid-template-columns: 1fr; }");
    expect(css).toContain(".ui-settings-col { display: flex; flex-direction: column;");
    expect(css).toContain(".ui-settings-form-2col { display: grid; grid-template-columns: 1fr 1fr;");
  });
});
