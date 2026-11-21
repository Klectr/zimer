import { describe, expect, test } from "bun:test";
import { statusChip } from "./status-chip";

describe("statusChip", () => {
  test("renders a filled chip with a capitalized word per status", () => {
    expect(statusChip("draft")).toBe('<span class="ui-chip ui-chip-draft">Draft</span>');
    expect(statusChip("sent")).toBe('<span class="ui-chip ui-chip-sent">Sent</span>');
    expect(statusChip("paid")).toBe('<span class="ui-chip ui-chip-paid">Paid</span>');
  });

  test("unknown status throws instead of rendering an unstyled chip", () => {
    expect(() => statusChip("vanished" as never)).toThrow(/unknown status/);
    expect(() => statusChip("PAID" as never)).toThrow(/unknown status/);
  });

  test("overdue throws: it is a derived state (sent + past due), not a stored status", () => {
    expect(() => statusChip("overdue" as never)).toThrow(/unknown status/);
  });

  test("#1214: overdue is a flag on a sent chip, with the error tone and word", () => {
    expect(statusChip("sent", { overdue: true })).toBe('<span class="ui-chip ui-chip-overdue">Overdue</span>');
    expect(statusChip("sent", { overdue: true, suffix: "3d" })).toBe('<span class="ui-chip ui-chip-overdue">Overdue 3d</span>');
  });

  test("#1214: overdue on a draft or paid Zinvoice throws", () => {
    expect(() => statusChip("draft", { overdue: true })).toThrow(/sent Zinvoices only/);
    expect(() => statusChip("paid", { overdue: true })).toThrow(/sent Zinvoices only/);
  });

  test("#1214: suffix is escaped and an icon leads the word", () => {
    const html = statusChip("paid", { icon: "check", suffix: "<b>Sep 21</b>" });
    expect(html.startsWith('<span class="ui-chip ui-chip-paid"><svg')).toBe(true);
    expect(html).toContain("Paid &lt;b&gt;Sep 21&lt;/b&gt;</span>");
  });
});
