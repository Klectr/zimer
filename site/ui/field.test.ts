import { describe, expect, test } from "bun:test";
import { selectField, textAreaField, textField } from "./field";

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

describe("textField datetime-local", () => {
  test("renders a datetime-local input (the edit-entry fields carry data-iso in attrs)", () => {
    const html = textField({ id: "ee-start", label: "Start", name: "start_time", type: "datetime-local", required: true, attrs: 'data-iso="2026-11-02T14:00:00.000Z"' });
    expect(html).toContain('<input class="ui-input" type="datetime-local" id="ee-start" name="start_time" required data-iso="2026-11-02T14:00:00.000Z">');
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

describe("selectField option descriptions", () => {
  test("desc rides on the option as data-desc for live helper text", () => {
    const html = selectField({ id: "t", label: "Terms", options: [{ value: "net15", label: "Net 15", desc: "Due 15 days after issue." }, { value: "due", label: "Due on receipt" }], value: "net15" });
    expect(html).toContain('data-desc="Due 15 days after issue."');
    expect(html).toContain('<option value="due">Due on receipt</option>');
  });
});

describe("selectField option data attributes", () => {
  test("data map renders as data-* attributes, escaped (#1121)", () => {
    const html = selectField({ id: "c", label: "Client", options: [{ value: "3", label: "Acme", data: { rate: 85, "terms-days": 15 } }, { value: "4", label: "B<x>" }], value: "3" });
    expect(html).toContain('<option value="3" data-rate="85" data-terms-days="15" selected>Acme</option>');
    expect(html).toContain('<option value="4">B&lt;x&gt;</option>');
  });
});

describe("selectField disabled", () => {
  test("disabled lands on the select (#1121)", () => {
    const html = selectField({ id: "p", label: "Project", options: [{ value: "1", label: "Website" }], disabled: true });
    expect(html).toContain('<select class="ui-input ui-select" id="p" disabled>');
    expect(selectField({ id: "p", label: "Project", options: [] })).not.toContain("disabled");
  });
});

describe("selectField className", () => {
  test("extra class lands on the select for behavior hooks", () => {
    const html = selectField({ id: "t", label: "Terms", options: [{ value: "a", label: "A" }], className: "terms-select" });
    expect(html).toContain('class="ui-input ui-select terms-select"');
  });
});

describe("textAreaField", () => {
  test("renders the label above a textarea with the escaped value as its content", () => {
    const html = textAreaField({ id: "addr", label: "Address", name: "address", value: "1 Main St\n<Suite 2>", rows: 3 });
    expect(html).toContain('<label class="ui-field-label" for="addr">Address</label>');
    expect(html).toContain('<textarea class="ui-input" id="addr" name="address" rows="3">1 Main St\n&lt;Suite 2&gt;</textarea>');
  });

  test("empty value renders an empty textarea; attrs pass through", () => {
    const html = textAreaField({ id: "addr", label: "Address", attrs: 'spellcheck="false"' });
    expect(html).toContain('spellcheck="false"></textarea>');
  });
});

describe("textField attrs", () => {
  test("raw attrs land on the input", () => {
    const html = textField({ id: "w", label: "Website", attrs: 'autocapitalize="none" spellcheck="false"' });
    expect(html).toContain('autocapitalize="none" spellcheck="false">');
  });
});
