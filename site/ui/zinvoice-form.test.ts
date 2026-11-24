import { describe, expect, test } from "bun:test";
import { unbilledTable } from "./zinvoice-form";

describe("unbilledTable (#1484)", () => {
  const rows = [
    { id: "e1", label: "Design — homepage pass", hours: "12.5h", amount: "$1,062.50", included: true },
    { id: "e2", label: "Internal planning (non-billable)", hours: "0.7h", amount: "$0.00", included: false },
  ];

  test("renders a ui-table with one row per entry", () => {
    const html = unbilledTable(rows);
    expect(html).toContain('<table class="ui-table">');
    expect(html).toContain("Design — homepage pass");
    expect(html).toContain("12.5h");
    expect(html).toContain("$1,062.50");
    expect(html).toContain('scope="col"');
  });

  test("included rows render a checked bare checkbox named for the entry", () => {
    const html = unbilledTable(rows);
    expect(html).toContain('aria-label="Include Design — homepage pass"');
    const inputFor = (id: string) => html.match(new RegExp(`<input[^>]*id="unbilled-${id}"[^>]*>`))?.[0] ?? "";
    expect(inputFor("e1")).toContain("checked");
    expect(inputFor("e2")).not.toContain("checked");
  });

  test("labels, hours and amounts are escaped", () => {
    const html = unbilledTable([{ id: "x<1", label: "<img src=x>", hours: "<b>1h</b>", amount: "$1 & <", included: true }]);
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain('id="unbilled-x&lt;1"');
    expect(html).toContain('aria-label="Include &lt;img src=x&gt;"');
    expect(html).toContain("&lt;b&gt;1h&lt;/b&gt;");
    expect(html).toContain("$1 &amp; &lt;");
  });

  test("no rows renders the empty-state row, not an empty table body", () => {
    const html = unbilledTable([]);
    expect(html).toContain("No unbilled time.");
  });
});
