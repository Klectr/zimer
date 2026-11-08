import type { Story } from "../.zandbox/story";
import { button } from "../site/ui/button";

export const buttonStories: Story[] = [
  {
    id: "button-variants",
    group: "Button",
    title: "Variants",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Send Zinvoice" }) +
      button({ label: "Save draft", variant: "tonal" }) +
      button({ label: "Cancel", variant: "text" }) +
      `</div>`,
  },
  {
    id: "button-danger",
    group: "Button",
    title: "Danger",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Delete client", variant: "text", danger: true }) +
      button({ label: "Delete entry", variant: "text", danger: true }) +
      `</div>`,
  },
  {
    id: "button-disabled",
    group: "Button",
    title: "Disabled",
    render: () =>
      `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">` +
      button({ label: "Send Zinvoice", disabled: true }) +
      button({ label: "Save draft", variant: "tonal", disabled: true }) +
      button({ label: "Cancel", variant: "text", disabled: true }) +
      `</div>`,
  },
];
