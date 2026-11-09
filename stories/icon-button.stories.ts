import type { Story } from "../.zandbox/story";
import { iconButton } from "../site/ui/icon-button";

export const iconButtonStories: Story[] = [
  {
    id: "icon-button-states",
    group: "Icon button",
    title: "States",
    render: () =>
      `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">` +
      iconButton({ icon: "edit", label: "Edit entry" }) +
      iconButton({ icon: "copy", label: "Copy Zinvoice link" }) +
      iconButton({ icon: "download", label: "Download PDF" }) +
      iconButton({ icon: "delete", label: "Delete entry", danger: true }) +
      iconButton({ icon: "edit", label: "Edit entry (disabled)", disabled: true }) +
      `</div>`,
  },
];
