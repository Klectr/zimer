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
const js = await Bun.file(new URL("popup.js", import.meta.url)).text();

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

/** #1185: the running view renders the story's rate + today tags from the
 *  /api/status payload (running.client_rate, today_seconds). popup.html
 *  carries the tags row and the primary tag style; popup.js asks for its
 *  own day bounds (#255) and reads both fields. */
describe("extension popup running tags (#1185)", () => {
  test("popup.html carries the tags row and the primary tag rule", () => {
    expect(html).toContain('id="run-tags"');
    expect(html).toContain(".ui-tag-primary { background: var(--color-primary-bg); color: var(--color-primary); }");
  });

  test("popup.js renders the tags from the payload and passes its day bounds", () => {
    expect(js).toContain('"/api/status?from="');
    expect(js).toContain("running.client_rate");
    expect(js).toContain("today_seconds");
    expect(js).toContain("ui-tag-primary");
    expect(js).toContain("ui-tag-neutral");
  });
});
