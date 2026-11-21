import { describe, expect, test } from "bun:test";

/** #1215: font sizes, radii and weights come from DESIGN.md's scales via
 *  tokens. The only literals allowed outside :root are the invoice DOCUMENT
 *  template (the printed/PDF-mirroring sheet) and the frozen pre-migration
 *  .md-table snapshots, which are served verbatim forever (#301, #1133). */
const css = await Bun.file(new URL("../static/style.css", import.meta.url)).text();

const DOCUMENT = /\.md-table|\.template-modern|\.inv-modern-|\.inv-dates-line/;
/* Named one-offs with their own pinned tests: the compact calendar hint on
   narrow viewports (#945). */
const EXCEPTIONS = new Set([".cal-supporting .cal-hint"]);

function rules(src: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

function offenders(prop: string, ok: RegExp): string[] {
  const bad: string[] = [];
  for (const { selector, body } of rules(css)) {
    if (selector === ":root" || selector.startsWith("@") || /^(from|to|\d+%)$/.test(selector)) continue;
    const decl = body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
    if (!decl) continue;
    const value = decl[1].trim();
    if (ok.test(value)) continue;
    const parts = selector.split(",").map((p) => p.trim());
    if (parts.every((p) => DOCUMENT.test(p) || EXCEPTIONS.has(p))) continue;
    bad.push(`${selector} { ${prop}: ${value} }`);
  }
  return bad;
}

describe("design-scale guard (#1215)", () => {
  test("font-size uses type tokens", () => {
    expect(offenders("font-size", /^(var\(--font-size[\w-]*\)|inherit|0)( !important)?$/)).toEqual([]);
  });

  test("border-radius uses radius tokens (pills and circles excepted)", () => {
    expect(offenders("border-radius", /^((var\(--radius[\w-]*\)|0|999px|9999px|50%|inherit)\s*)+( !important)?$/)).toEqual([]);
  });

  test("font-weight stays on 400 / 500 / the strong token", () => {
    expect(offenders("font-weight", /^(400|500|600|normal|inherit|var\(--font-weight-strong\))( !important)?$/)).toEqual([]);
  });

  test("the frozen .md-table rules are still present (never drop them)", () => {
    expect(css).toContain(".md-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }");
  });
});
