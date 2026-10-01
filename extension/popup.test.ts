/** #515: the extension popup's labels must be wired to their inputs and
 *  its error regions announced, so clicking a label focuses the field,
 *  screen readers pair names with fields, and failures get announced.
 *
 *  popup.html is static markup (no build step); the test reads the file and
 *  asserts on the string: every visible label carries a for= matching a real
 *  id, no form field is nameless, and each error region has role=alert.
 */
import { describe, expect, test } from "bun:test";
import { matchRule, upsertRule } from "./rules.js";

const html = await Bun.file(new URL("popup.html", import.meta.url)).text();

describe("extension popup label wiring (#515)", () => {
  test("every visible <label> has a for= matching an existing id", () => {
    const labels = [...html.matchAll(/<label\b[^>]*>/g)];
    expect(labels.length).toBeGreaterThan(0);
    for (const m of labels) {
      const forAttr = m[0].match(/\bfor="([^"]+)"/);
      expect(forAttr, `label missing for=: ${m[0]}`).not.toBeNull();
      const id = forAttr![1];
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("no form field is nameless: every input/select has a label[for] or aria-label", () => {
    const fields = [...html.matchAll(/<(input|select)\b[^>]*>/g)];
    expect(fields.length).toBeGreaterThan(0);
    for (const m of fields) {
      if (m[0].includes('type="hidden"')) continue;
      const id = m[0].match(/\bid="([^"]+)"/);
      const aria = m[0].match(/\baria-label="([^"]+)"/);
      const byLabel = id && new RegExp(`<label[^>]*\\bfor="${id[1]}"`).test(html);
      expect(byLabel || aria, `nameless field: ${m[0]}`).toBeTruthy();
    }
  });

  test("each error region is announced to screen readers", () => {
    for (const id of ["setup-error", "main-error", "rules-error"]) {
      const tag = html.match(new RegExp(`<div id="${id}"[^>]*>`));
      expect(tag, `#${id} missing`).not.toBeNull();
      expect(tag![0]).toContain('role="alert"');
    }
  });
});

/** #695: the suggestion-card headline must carry a title treatment in the
 *  popup stylesheet — it renders the "Start **X**?" question as a div with
 *  no class, so without a #suggest-text rule it degrades to plain body text
 *  next to the styled eyebrow and desc line. */
describe("extension popup suggestion headline (#695)", () => {
  test("#suggest-text has a title-style rule in the popup stylesheet", () => {
    const rule = html.match(/#suggest-text\s*\{([^}]*)\}/);
    expect(rule, "no #suggest-text rule in popup.html <style>").not.toBeNull();
    const body = rule![1];
    const size = body.match(/font-size:\s*(\d+)px/);
    expect(size, "#suggest-text missing font-size").not.toBeNull();
    expect(Number(size![1])).toBeGreaterThanOrEqual(15);
    expect(body).toMatch(/font-weight:\s*600/);
  });
});

/** #641: autotracker rules upsert — adding a pattern that already has a rule
 *  updates that rule's project instead of stacking a dead duplicate that
 *  matchRule would never reach. */
describe("autotracker rule helpers (#641)", () => {
  const rules = () => [
    { id: "r1", pattern: "github.com", projectId: 1, projectName: "Code" },
    { id: "r2", pattern: "docs", projectId: 2, projectName: "Writing" },
  ];

  test("matchRule finds by title substring and URL substring, case-insensitively", () => {
    const rs = rules();
    expect(matchRule(rs, "Fix bug — repo", "https://github.com/tristonarmstrong/timekeep")!.id).toBe("r1");
    expect(matchRule(rs, "Notes", "https://x.test/my-docs/page")!.id).toBe("r2");
    expect(matchRule(rs, "GITHUB.COM pull request", "")!.id).toBe("r1");
  });

  test("matchRule returns null on no match, and the first of several matches", () => {
    const rs = [{ id: "a", pattern: "x", projectId: 1 }, { id: "b", pattern: "x", projectId: 2 }];
    expect(matchRule(rules(), "nothing here", "https://nowhere.test")).toBeNull();
    expect(matchRule(rs, "x marks", "")!.id).toBe("a");
  });

  test("upsertRule appends a new pattern and trims whitespace", () => {
    const rs = rules();
    const { rules: out, updated } = upsertRule(rs, "  linear.app  ", 3, "Tasks");
    expect(updated).toBe(false);
    expect(out).toHaveLength(3);
    expect(out[2].pattern).toBe("linear.app");
    expect(out[2].projectId).toBe(3);
  });

  test("upsertRule updates the existing rule case-insensitively, no duplicate", () => {
    const rs = rules();
    const { rules: out, updated } = upsertRule(rs, "GITHUB.COM", 9, "New project");
    expect(updated).toBe(true);
    expect(out).toHaveLength(2);
    expect(out[0].projectId).toBe(9);
    expect(out[0].projectName).toBe("New project");
    // the stored pattern keeps its original casing
    expect(out[0].pattern).toBe("github.com");
    // the matcher now resolves to the updated project
    expect(matchRule(out, "pull request", "https://github.com/tristonarmstrong/timekeep")!.projectId).toBe(9);
  });

  test("upsertRule tolerates a missing rules list", () => {
    const { rules: out, updated } = upsertRule(undefined, "x.test", 1, "P");
    expect(updated).toBe(false);
    expect(out).toHaveLength(1);
  });
});
