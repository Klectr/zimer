import { describe, expect, test } from "bun:test";
import { appSidebar } from "./app-sidebar";
import { appHeader } from "./app-header";
import { tabs } from "./tabs";
import { logoLockup } from "./logo-lockup";
import { runningIndicator } from "./running-indicator";

const NAV = [
  { key: "timer", href: "/", label: "Zimer", icon: "timer" as const },
  { key: "invoices", href: "/invoices", label: "Zinvoices", icon: "receipt" as const },
];

describe("logoLockup", () => {
  test("renders the mark tile and wordmark", () => {
    const html = logoLockup();
    expect(html).toContain('class="ui-logo"');
    expect(html).toContain('class="ui-logo-mark"');
    expect(html).toContain(">Zimer</span>");
  });
});

describe("appSidebar", () => {
  test("marks the active item with is-active and aria-current", () => {
    const html = appSidebar({ items: NAV, active: "invoices" });
    expect(html).toContain('class="ui-navitem is-active"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/invoices"');
    expect(html).toContain('class="ui-logo"');
  });

  test("footer renders only when provided", () => {
    expect(appSidebar({ items: NAV, active: "timer" })).not.toContain("ui-side-foot");
    expect(appSidebar({ items: NAV, active: "timer", footer: "x" })).toContain("ui-side-foot");
  });
});

describe("appHeader", () => {
  test("renders title, optional sub, and actions", () => {
    const html = appHeader({ title: "Zinvoices", sub: "3 unpaid", actions: "<button>New</button>" });
    expect(html).toContain('<h1 class="ui-app-title">Zinvoices</h1>');
    expect(html).toContain('<p class="ui-app-sub">3 unpaid</p>');
    expect(html).toContain('<div class="ui-app-actions"><button>New</button></div>');
    expect(appHeader({ title: "Zimer" })).not.toContain("ui-app-sub");
  });

  test("title and sub are escaped", () => {
    const html = appHeader({ title: "<b>X</b>", sub: "<i>Y</i>" });
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("runningIndicator", () => {
  test("renders a link with dot, label, and mono elapsed time", () => {
    const html = runningIndicator({ label: "Website redesign", elapsed: "1:24:08", href: "/" });
    expect(html).toContain('class="ui-running"');
    expect(html).toContain('class="ui-running-dot"');
    expect(html).toContain("Website redesign");
    expect(html).toContain('<span class="ui-running-time">1:24:08</span>');
    expect(html).toContain('href="/"');
  });
});

describe("tabs", () => {
  test("marks the active tab and labels the nav", () => {
    const html = tabs({
      label: "Settings sections",
      active: "billing",
      items: [
        { key: "profile", href: "/settings", label: "Profile" },
        { key: "billing", href: "/settings/billing", label: "Billing" },
      ],
    });
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('class="ui-tab is-active"');
    expect(html).toContain('aria-current="page"');
  });
});
