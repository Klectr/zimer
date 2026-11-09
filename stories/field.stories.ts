import type { Story } from "../.zandbox/story";
import { selectField, textField } from "../site/ui/field";
import { button } from "../site/ui/button";

export const fieldStories: Story[] = [
  {
    id: "field-text",
    group: "Field",
    title: "Text fields",
    render: () =>
      `<div style="display:grid;gap:16px;max-width:420px">` +
      textField({ id: "f-client", label: "Client name", name: "name" }) +
      textField({ id: "f-email", label: "Email", name: "email", type: "email", value: "billing@northwind.example", autocomplete: "email" }) +
      textField({ id: "f-rate", label: "Hourly rate", name: "rate", type: "number", value: "85", required: true }) +
      `</div>`,
  },
  {
    id: "field-select",
    group: "Field",
    title: "Select field",
    render: () =>
      `<div style="display:grid;gap:16px;max-width:420px">` +
      selectField({
        id: "f-project",
        label: "Project",
        name: "project",
        value: "site",
        options: [
          { value: "", label: "No project" },
          { value: "site", label: "Website redesign" },
          { value: "support", label: "Support retainer" },
        ],
      }) +
      `</div>`,
  },
  {
    id: "field-affixes",
    group: "Field",
    title: "Affixes (units live in the affix, never the label)",
    render: () =>
      `<div style="display:grid;gap:16px;max-width:420px">` +
      textField({ id: "f-target", label: "Daily hours target", name: "day_target_hours", type: "number", value: "8", suffix: "hr", min: "1", max: "24", step: "0.5", inputmode: "decimal" }) +
      textField({ id: "f-rate-affix", label: "Hourly rate", name: "rate", type: "number", value: "100", prefix: "$", suffix: "/hr" }) +
      `</div>`,
  },
  {
    id: "field-in-form",
    group: "Field",
    title: "In a form (form sits at the top)",
    render: () =>
      `<form style="display:grid;gap:16px;max-width:420px">` +
      textField({ id: "f-new-client", label: "New client", name: "name", required: true }) +
      `<div>` + button({ label: "Add client", type: "submit" }) + `</div>` +
      `</form>`,
  },
];
