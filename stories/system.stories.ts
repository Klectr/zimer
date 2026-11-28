import type { Story } from "../.zandbox/story";
import { commandLine, statusRow } from "../site/ui/status-row";
import { errorPage } from "../site/ui/error-page";
import { navDrawer } from "../site/ui/nav-drawer";
import { linkButton, button } from "../site/ui/button";
import { logo } from "../site/lib/icons";

/* Fictional data only. */
const wrap = (inner: string) => `<div style="max-width:560px;display:flex;flex-direction:column;gap:16px">${inner}</div>`;

export const systemStories: Story[] = [
  {
    id: "system-update-status",
    group: "System",
    title: "Update status — every outcome",
    render: () => wrap(
      statusRow({ icon: "info", headline: "Zimer v1.4.0", supporting: "Press the button to check for new releases." }) +
      statusRow({ icon: "check", headline: "You're up to date", supporting: "Zimer v1.4.0" }) +
      `<div>${statusRow({ icon: "download", tone: "primary", headline: "v1.5.0 is available", supporting: "You're on v1.4.0 — re-run the installer to update." }) +
        commandLine({ note: "Your data, token, and settings are preserved:", command: "curl -fsSL https://zimer.example/install.sh | bash" })}</div>` +
      statusRow({ icon: "alert", tone: "error", headline: "Couldn't reach the update server", supporting: "Check your connection and try again." }) +
      statusRow({ icon: "info", headline: "Development build", supporting: "Update checks are disabled." }),
    ),
  },
  {
    id: "system-error-pages",
    group: "System",
    title: "Error pages — 404, 500, unknown Zinvoice, 429",
    render: () => wrap(
      errorPage({ title: "Page not found", body: "The page you’re looking for doesn’t exist or was moved.", actionsHtml: linkButton({ label: "Zimer", href: "#", variant: "primary" }) + linkButton({ label: "Calendar", href: "#", variant: "ghost" }) + linkButton({ label: "Zinvoices", href: "#", variant: "ghost" }) + linkButton({ label: "Clients", href: "#", variant: "ghost" }) }) +
      errorPage({ title: "Something went wrong", body: "An unexpected error occurred. Please try again.", actionsHtml: button({ label: "Go back" }) + linkButton({ label: "Zimer", href: "#", variant: "primary" }) }) +
      errorPage({ markHtml: logo(40), title: "This Zinvoice doesn’t exist.", body: "The link you followed doesn’t match any Zinvoice. Check the address, or ask the sender for a fresh link." }) +
      errorPage({ markHtml: logo(40), title: "Too many requests.", body: "Please slow down and try again in a bit." }),
    ),
  },
  {
    id: "system-nav-drawer",
    group: "System",
    title: "Navigation drawer (compact screens) — open",
    /* Shown open: the stage has no app bar to open it from. */
    render: () =>
      `<style>.zb-drawer-open .nav-drawer-scrim{position:relative;inset:auto;min-height:320px;opacity:1}.zb-drawer-open .nav-drawer{transform:none;position:absolute}</style>` +
      `<div class="zb-drawer-open">` +
      navDrawer({ rows: [{ icon: "settings", label: "Settings", href: "#" }, { icon: "logout", label: "Log out", postAction: "#" }] }).replace(" hidden>", ">") +
      `</div>`,
  },
];
