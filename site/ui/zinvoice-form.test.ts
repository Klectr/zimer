import { describe, expect, test } from "bun:test";
import { unbilledTable } from "./zinvoice-form";

describe("unbilledTable (#1484)", () => {
  const rows = [
    { id: "e1", label: "Design — homepage pass", hours: "12.5h", amount: "$1,062.50", included: true },
    { id: "e2", label: "Internal planning (non-billable)", hours: "0.7h", amount: "$0.00", included: false },
  ];

  test("renders a ui-table with one row per entry", () => {
    const html = unbilledTable(rows);
    expect(html).toContain('<table class="ui-table ui-unbilled">');
    expect(html).toContain("Design — homepage pass");
    expect(html).toContain("12.5h");
    expect(html).toContain("$1,062.50");
    expect(html).toContain('scope="col"');
  });

  test("included rows render a checked bare checkbox named for the entry", () => {
    const html = unbilledTable(rows);
    expect(html).toContain('id="unbilled-e1"');
    expect(html).toContain('aria-label="Include Design — homepage pass"');
    const e1 = html.slice(html.indexOf('id="unbilled-e1"'), html.indexOf('id="unbilled-e1"') + 40);
    expect(e1).toContain("checked");
    const e2 = html.slice(html.indexOf('id="unbilled-e2"'), html.indexOf('id="unbilled-e2"') + 40);
    expect(e2).not.toContain("checked");
  });

  test("labels, hours and amounts are escaped", () => {
    const html = unbilledTable([{ id: "x<1", label: "<img src=x>", hours: "1h", amount: "$1", included: true }]);
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).not.toContain('id="unbilled-x<1"');
  });

  test("no rows renders the empty-state row, not an empty table body", () => {
    const html = unbilledTable([]);
    expect(html).toContain("No unbilled time.");
  });
});
