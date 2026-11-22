import type { Story } from "../.zandbox/story";
import { shareLine } from "../site/ui/share-line";
import { iconButton } from "../site/ui/icon-button";
import { button, linkButton } from "../site/ui/button";

/* Fictional data. Shown in a card-width column, as it sits in a rail. */
const icons = iconButton({ icon: "copy", label: "Copy link" }) + iconButton({ icon: "refresh", label: "Regenerate link" }) + iconButton({ icon: "delete", label: "Revoke link", danger: true });

export const shareLineStories: Story[] = [
  {
    id: "share-line",
    group: "Data",
    title: "Share line — link, action only, warning, wrapping note",
    render: () =>
      `<div class="ui-card share-lines" style="max-width:360px">` +
      shareLine({ label: "Client link", url: "https://zimer.example/i/x7f2demo-token-123456", actionsHtml: icons }) +
      shareLine({ label: "Client link", actionsHtml: button({ label: "Create client link", icon: "add" }) }) +
      shareLine({ label: "Payment link", warn: true, text: "Couldn't create it — the client won't see a Pay button", actionsHtml: iconButton({ icon: "refresh", label: "Retry" }) }) +
      shareLine({ label: "How to pay", warn: true, note: "Your client won't see how to pay.", actionsHtml: linkButton({ label: "Add payment instructions", href: "#", size: "sm" }) }) +
      `</div>`,
  },
];
