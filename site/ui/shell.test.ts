import { describe, expect, test } from "bun:test";
import { appSidebar } from "./app-sidebar";
import { appHeader } from "./app-header";
import { logoLockup } from "./logo-lockup";

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

  test("subId lands on the sub paragraph for out-of-band refresh (#1121)", () => {
    const html = appHeader({ title: "Zinvoices", sub: "Outstanding $1", subId: "inv-sub" });
    expect(html).toContain('<p class="ui-app-sub" id="inv-sub">Outstanding $1</p>');
  });
});


