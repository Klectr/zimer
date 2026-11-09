import type { Story } from "../.zandbox/story";
import { appSidebar } from "../site/ui/app-sidebar";
import { appHeader } from "../site/ui/app-header";
import { tabs } from "../site/ui/tabs";
import { button } from "../site/ui/button";
import { logoLockup } from "../site/ui/logo-lockup";
import { runningIndicator } from "../site/ui/running-indicator";

const NAV = [
  { key: "timer", href: "/", label: "Zimer", icon: "timer" as const },
  { key: "calendar", href: "/calendar", label: "Calendar", icon: "calendar" as const },
  { key: "invoices", href: "/invoices", label: "Zinvoices", icon: "receipt" as const },
  { key: "manage", href: "/manage", label: "Clients", icon: "group" as const },
  { key: "settings", href: "/settings", label: "Settings", icon: "settings" as const },
];

export const shellStories: Story[] = [
  {
    id: "shell-logo",
    group: "Shell",
    title: "Logo lockup",
    render: () => logoLockup(),
  },
  {
    id: "shell-sidebar",
    group: "Shell",
    title: "Sidebar",
    render: () =>
      `<div style="display:flex;height:340px;border:1px solid var(--color-border-secondary);border-radius:12px;overflow:hidden">` +
      appSidebar({
        items: NAV,
        active: "invoices",
        footer: `<span style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">Gail's workspace</span>`,
      }) +
      `<div style="padding:16px;color:var(--color-text-secondary);font-size:var(--font-size-sm)">Content area</div></div>`,
  },
  {
    id: "shell-header-tabs",
    group: "Shell",
    title: "Header + tabs",
    render: () =>
      appHeader({ title: "Settings", sub: "Profile, billing, and your data." }) +
      `<div style="display:flex;align-items:center;gap:12px;margin-top:16px">` +
      tabs({
        label: "Settings sections",
        active: "profile",
        items: [
          { key: "profile", href: "/settings", label: "Profile" },
          { key: "billing", href: "/settings/billing", label: "Billing" },
          { key: "data", href: "/settings/data", label: "Data" },
        ],
      }) +
      `<span style="margin-left:auto">` +
      button({ label: "Save changes" }) +
      `</span></div>`,
  },
  {
    id: "shell-full",
    group: "Shell",
    title: "Full shell",
    render: () =>
      `<div style="display:flex;height:340px;border:1px solid var(--color-border-secondary);border-radius:12px;overflow:hidden">` +
      appSidebar({ items: NAV, active: "timer" }) +
      `<div style="flex:1;padding:20px;min-width:0">` +
      appHeader({
        title: "Zimer",
        sub: "Tuesday, Nov 3 · 6h 24m tracked",
        actions:
          runningIndicator({ label: "Website redesign", elapsed: "1:24:08", href: "/" }) +
          button({ label: "New entry", variant: "primary" }),
      }) +
      `</div></div>`,
  },
];
