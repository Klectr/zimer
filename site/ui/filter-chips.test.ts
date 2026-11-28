import { describe, expect, test } from "bun:test";
import { filterChips } from "./filter-chips";

describe("filterChips", () => {
  const items = [
    { key: "all", label: "All", href: "/invoices" },
    { key: "draft", label: "Draft", href: "/invoices?status=draft" },
    { key: "overdue", label: "Overdue", href: "/invoices?status=overdue" },
  ];

  test("renders one link per item inside a labelled nav", () => {
    const html = filterChips({ items, active: "all", label: "Filter zinvoices" });
    expect(html).toContain('<nav class="ui-filter-chips" aria-label="Filter zinvoices">');
    expect(html).toContain('<a href="/invoices" class="ui-filter-chip is-active" aria-current="true">All</a>');
    expect(html).toContain('<a href="/invoices?status=draft" class="ui-filter-chip">Draft</a>');
    expect(html).toContain('<a href="/invoices?status=overdue" class="ui-filter-chip">Overdue</a>');
  });

  test("only the active item carries aria-current", () => {
    const html = filterChips({ items, active: "draft", label: "Filter zinvoices" });
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(html).toContain('<a href="/invoices?status=draft" class="ui-filter-chip is-active" aria-current="true">Draft</a>');
  });

  test("extra attributes land on the chip for htmx swaps", () => {
    const html = filterChips({
      items: [{ key: "sent", label: "Sent", href: "/invoices?status=sent", attrs: 'hx-get="/invoices?status=sent" hx-target="#inv-list-region" hx-swap="innerHTML" hx-push-url="true"' }],
      active: "sent",
      label: "Filter",
    });
    expect(html).toContain('hx-get="/invoices?status=sent"');
    expect(html).toContain('hx-target="#inv-list-region"');
    expect(html).toContain('hx-push-url="true"');
  });

  test("labels and hrefs are escaped", () => {
    const html = filterChips({
      items: [{ key: "x", label: "<b>", href: '/invoices?q="x"' }],
      active: "x",
      label: "Filter",
    });
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain('href="/invoices?q=&quot;x&quot;"');
  });
});
