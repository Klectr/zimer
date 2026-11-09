import type { Story } from "../.zandbox/story";
import { button } from "../site/ui/button";

export const buttonStories: Story[] = [
  {
    id: "button-variants",
    group: "Button",
    title: "Variants",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Send Zinvoice", variant: "primary" }) +
      button({ label: "Save draft" }) +
      button({ label: "Cancel", variant: "ghost" }) +
      `</div>`,
  },
  {
    id: "button-danger",
    group: "Button",
    title: "Danger",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Delete entry", danger: true }) +
      button({ label: "Delete client", variant: "ghost", danger: true }) +
      button({ label: "Delete Zinvoice", variant: "primary", danger: true }) +
      `</div>`,
  },
  {
    id: "button-sizes",
    group: "Button",
    title: "Sizes",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Small", size: "sm" }) +
      button({ label: "Medium" }) +
      button({ label: "Large", size: "lg", variant: "primary" }) +
      `</div>`,
  },
  {
    id: "button-disabled",
    group: "Button",
    title: "Disabled",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Send Zinvoice", variant: "primary", disabled: true }) +
      button({ label: "Save draft", disabled: true }) +
      button({ label: "Cancel", variant: "ghost", disabled: true }) +
      `</div>`,
  },
];
