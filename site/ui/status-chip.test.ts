import { describe, expect, test } from "bun:test";
import { statusChip } from "./status-chip";

describe("statusChip", () => {
  test("renders a filled pill with a capitalized word per status", () => {
    expect(statusChip("draft")).toBe('<span class="pill pill-draft">Draft</span>');
    expect(statusChip("sent")).toBe('<span class="pill pill-sent">Sent</span>');
    expect(statusChip("paid")).toBe('<span class="pill pill-paid">Paid</span>');
  });

  test("unknown status throws instead of rendering an unstyled pill", () => {
    expect(() => statusChip("vanished" as never)).toThrow(/unknown status/);
    expect(() => statusChip("PAID" as never)).toThrow(/unknown status/);
  });

  test("overdue throws: it is a derived state (sent + past due), not a stored status", () => {
    expect(() => statusChip("overdue" as never)).toThrow(/unknown status/);
  });
});
