/** Two-way CSS coverage, computed rather than hand-listed:
 *  1. every class a site/ui component emits (rendered through its Zandbox
 *     stories) has a selector in style.css — no unstyled component markup;
 *  2. every class style.css styles is produced by app code (views, routes,
 *     components, browser scripts, the extension) — no dead CSS.
 *  These replace hand-maintained selector lists and per-deletion "stays out
 *  of style.css" tombstones: removing code now fails here until its CSS goes
 *  too, and adding a component fails until it's styled. */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import config from "../../zandbox.config";

const css = await Bun.file("site/static/style.css").text();
/* Selectors only: drop comments, strings and url(...) so "logo.svg" or
   "0.5rem" never read as classes; ".a.is-x" compounds count .is-x. */
const cssSelectors = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "").replace(/"[^"]*"|'[^']*'/g, "");
const styled = new Set([...cssSelectors.matchAll(/(?<![\d-])\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!));

let appCode = "";
for (const pat of ["site/**/*.ts", "site/static/*.js", "extension/**/*.{js,html}"]) {
  for await (const f of new Glob(pat).scan(".")) {
    if (f.endsWith(".test.ts")) continue;
    appCode += "\n" + (await Bun.file(f).text());
  }
}

/** Classes that are styled but emitted by no current code, on purpose. */
const STYLED_WITHOUT_PRODUCER: Record<string, string> = {
  "md-table": "frozen pre-migration invoice snapshots (#301) still carry it and are served verbatim forever",
  "htmx-request": "added by htmx at runtime while a request is in flight",
  "htmx-settling": "added by htmx at runtime during the settle phase",
  "htmx-swapping": "added by htmx at runtime during the swap phase",
};

/** Classes components emit that need no rule of their own: JS hooks and
 *  state classes styled only in combination (e.g. .ui-chip.is-x). */
const EMITTED_WITHOUT_RULE = new Set<string>([
  /* component roots: a stable hook; their children carry the styles */
  "ui-changelog", "ui-feature", "ui-form-section",
]);

function producedByApp(c: string): boolean {
  if (new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(appCode)) return true;
  /* names built in templates: `ui-chip-${tone}`, `is-${status}`, "ui-btn-" + v */
  const parts = c.split("-");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join("-") + "-";
    if (appCode.includes(prefix + "${") || appCode.includes(`"${prefix}" +`) || appCode.includes(`'${prefix}'+`) || appCode.includes(`'${prefix}' +`)) return true;
  }
  return false;
}

describe("CSS coverage", () => {
  test("every class style.css styles is produced by app code (no dead CSS)", () => {
    const dead = [...styled].filter((c) => !producedByApp(c) && !(c in STYLED_WITHOUT_PRODUCER)).sort();
    expect(dead).toEqual([]);
  });

  test("allow-listed classes are still unproduced (drop them from the list otherwise)", () => {
    for (const c of Object.keys(STYLED_WITHOUT_PRODUCER)) {
      expect(styled.has(c)).toBe(true);
      expect(producedByApp(c)).toBe(false);
    }
  });

  test("every class a component emits in its stories has a rule in style.css", () => {
    const emitted = new Set<string>();
    for (const story of config.stories) {
      const html = story.render();
      /* story-local helper classes are styled by the story's own <style> */
      const local = new Set([...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].flatMap((m) => [...m[1]!.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]!)));
      for (const m of html.matchAll(/class="([^"]*)"/g)) {
        for (const c of m[1]!.split(/\s+/)) if (c && !local.has(c) && !c.startsWith("zb-")) emitted.add(c);
      }
    }
    const unstyled = [...emitted].filter((c) => !styled.has(c) && !EMITTED_WITHOUT_RULE.has(c)).sort();
    expect(unstyled).toEqual([]);
  });
});
