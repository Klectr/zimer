import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../static/style.css"), "utf8");

const RULES = [
  ".ui-btn {",
  ".ui-btn-primary {",
  ".ui-btn-ghost {",
  ".ui-btn-danger {",
  ".ui-btn-sm {",
  ".ui-btn-lg {",
  ".ui-chip {",
  ".ui-chip-draft {",
  ".ui-chip-sent {",
  ".ui-chip-paid {",
  ".ui-field {",
  ".ui-field-label {",
  ".ui-input {",
  ".ui-select {",
  ".ui-card {",
  ".ui-card.tracking {",
];

describe("ui component CSS", () => {
  test("every class the site/ui components emit has a rule in style.css", () => {
    for (const rule of RULES) {
      expect(css).toContain(rule);
    }
  });
});
