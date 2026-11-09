import { describe, expect, test } from "bun:test";
import { selectField, textField } from "./field";

describe("textField", () => {
  test("renders the LobeHub field structure: visible label above the input", () => {
    const html = textField({ id: "email", label: "Email", name: "email", type: "email" });
    expect(html).toBe(
      '<div class="ui-field">' +
        '<label class="ui-field-label" for="email">Email</label>' +
        '<input class="ui-input" type="email" id="email" name="email"></div>',
    );
  });

  test("defaults type to text and includes value/placeholder/required/autocomplete when set", () => {
    const html = textField({
      id: "rate",
      label: "Rate",
      value: "85",
      placeholder: "0",
      required: true,
      autocomplete: "off",
    });
    expect(html).toContain('type="text"');
    expect(html).toContain('value="85"');
    expect(html).toContain('placeholder="0"');
    expect(html).toContain("required");
    expect(html).toContain('autocomplete="off"');
  });

  test("escapes attribute and label content", () => {
    const html = textField({ id: 'x"y', label: "<b>Name</b>", value: '"><script>' });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&quot;");
  });
});

describe("selectField", () => {
  test("renders the label above a custom-chevron select with the selected option", () => {
    const html = selectField({
      id: "project",
      label: "Project",
      value: "site",
      options: [
        { value: "", label: "No project" },
        { value: "site", label: "Website redesign" },
      ],
    });
    expect(html).toContain('<div class="ui-field">');
    expect(html).toContain('<label class="ui-field-label" for="project">Project</label>');
    expect(html).toContain('<select class="ui-input ui-select" id="project">');
    expect(html).toContain('<option value="site" selected>Website redesign</option>');
    expect(html).toContain('<option value="">No project</option>');
  });

  test("escapes option values and labels", () => {
    const html = selectField({
      id: "p",
      label: "P",
      options: [{ value: 'a"b', label: "<i>X</i>" }],
    });
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;i&gt;");
    expect(html).toContain("a&quot;b");
  });
});

describe("textField affixes and numeric attrs", () => {
  test("suffix renders inside the input wrap and numeric attrs land", () => {
    const html = textField({ id: "dt", label: "Daily hours target", name: "day_target_hours", type: "number", value: "8", suffix: "hr", min: "1", max: "24", step: "0.5", inputmode: "decimal" });
    expect(html).toContain('class="ui-input-wrap"');
    expect(html).toContain('<span class="ui-affix ui-affix-suffix">hr</span>');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="24"');
    expect(html).toContain('step="0.5"');
    expect(html).toContain('inputmode="decimal"');
  });
  test("prefix and suffix can combine; no affix means no wrap", () => {
    const both = textField({ id: "r", label: "Hourly rate", prefix: "$", suffix: "/hr" });
    expect(both).toContain('<span class="ui-affix ui-affix-prefix">$</span>');
    expect(both).toContain('<span class="ui-affix ui-affix-suffix">/hr</span>');
    expect(textField({ id: "p", label: "Plain" })).not.toContain("ui-input-wrap");
  });
});
