/** #515: the extension popup's labels must be wired to their inputs and
 *  its error regions announced, so clicking a label focuses the field,
 *  screen readers pair names with fields, and failures get announced.
 *
 *  popup.html is static markup (no build step); the test reads the file and
 *  asserts on the string: every visible label carries a for= matching a real
 *  id, no form field is nameless, and each error region has role=alert.
 */
import { describe, expect, test } from "bun:test";

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
    for (const id of ["setup-error", "main-error"]) {
      const tag = html.match(new RegExp(`<div id="${id}"[^>]*>`));
      expect(tag, `#${id} missing`).not.toBeNull();
      expect(tag![0]).toContain('role="alert"');
    }
  });
});
