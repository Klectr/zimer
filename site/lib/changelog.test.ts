import { describe, expect, test } from "bun:test";
import { inlineMd } from "./changelog.ts";

/* #867: the /changelog page's tiny markdown subset now renders `code`
   spans; backticks must not leak through as literal text. */
describe("inlineMd", () => {
  test("code span renders as <code>", () => {
    expect(inlineMd("uses `--primary` now")).toBe("uses <code>--primary</code> now");
  });
  test("bold still renders", () => {
    expect(inlineMd("**One place** to change it")).toBe("<strong>One place</strong> to change it");
  });
  test("bold wrapping a code span nests cleanly", () => {
    expect(inlineMd("**click `Load demo data`**")).toBe("<strong>click <code>Load demo data</code></strong>");
  });
  test("html inside is escaped before markup is restored", () => {
    expect(inlineMd("`<b>nope</b>`")).toBe("<code>&lt;b&gt;nope&lt;/b&gt;</code>");
    expect(inlineMd("**<script>**")).toBe("<strong>&lt;script&gt;</strong>");
  });
  test("unmatched backtick stays literal", () => {
    expect(inlineMd("a `stray one")).toBe("a `stray one");
  });
});
