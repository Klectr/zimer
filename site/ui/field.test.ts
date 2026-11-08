import { describe, expect, test } from "bun:test";
import { selectField, textField } from "./field";

describe("textField", () => {
  test("renders the floating-label structure the views use: input before label, blank placeholder", () => {
    const html = textField({ id: "email", label: "Email", name: "email", type: "email" });
    expect(html).toBe(
      '<div class="md-text-field">' +
        '<input type="email" id="email" name="email" placeholder=" ">' +
        '<label for="email">Email</label></div>',
    );
  });

  test("defaults type to text and includes value/required/autocomplete when set", () => {
    const html = textField({ id: "rate", label: "Rate", value: "85", required: true, autocomplete: "off" });
    expect(html).toContain('type="text"');
    expect(html).toContain('value="85"');
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
  test("renders the filled wrapper, aria-label, and the selected option", () => {
    const html = selectField({
      id: "project",
      label: "Project",
      value: "site",
      options: [
        { value: "", label: "No project" },
        { value: "site", label: "Website redesign" },
      ],
    });
    expect(html).toContain('<div class="md-text-field filled">');
    expect(html).toContain('aria-label="Project"');
    expect(html).toContain('<option value="site" selected>Website redesign</option>');
    expect(html).toContain('<option value="">No project</option>');
    expect(html).toContain('<label for="project">Project</label>');
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
