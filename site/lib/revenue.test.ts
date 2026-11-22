import { describe, expect, test } from "bun:test";
import { createRevenue } from "./revenue.ts";

function row(status: string, subtotal: number, extra: Record<string, unknown> = {}) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return {
    id: 1, number: "TEST-001", due_date: null, status, tax_rate: 0,
    issue_date: `${ym}-15`, client_id: 7, client_name: "Acme",
    client_color: null, client_payment_terms: null, subtotal, ...extra,
  };
}

function revenue(rows: ReturnType<typeof row>[]) {
  return createRevenue({ all: () => rows } as any, () => "");
}

describe("revenue totals exclude drafts (#1126)", () => {
  const rows = [row("sent", 2730), row("draft", 1827.5), row("paid", 425)];

  test("outstanding is sent only, matching the Zinvoices page", () => {
    expect(revenue(rows).revenueTotals()).toEqual({ invoiced: 3155, paid: 425, outstanding: 2730 });
  });

  test("monthly invoiced excludes drafts", () => {
    const months = revenue(rows).revenueMonthly();
    const current = months[months.length - 1];
    expect(current.invoiced).toBe(3155);
    expect(current.paid).toBe(425);
  });

  test("per-client outstanding excludes drafts", () => {
    const byClient = revenue(rows).revenueByClient();
    expect(byClient).toHaveLength(1);
    expect(byClient[0].invoiced).toBe(3155);
    expect(byClient[0].outstanding).toBe(2730);
  });

  test("a draft-only client does not appear", () => {
    expect(revenue([row("draft", 500)]).revenueByClient()).toEqual([]);
    expect(revenue([row("draft", 500)]).revenueTotals()).toEqual({ invoiced: 0, paid: 0, outstanding: 0 });
  });
});

describe("revenue snapshot reads the rows once (#1367)", () => {
  const past = new Date(Date.now() - 40 * 86_400_000);
  const pastYmd = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
  const rows = [
    row("sent", 2730),
    row("draft", 1827.5),
    row("paid", 425),
    row("sent", 200, { id: 2, number: "TEST-002", due_date: pastYmd }),
  ];

  test("one row fetch for all four figures", () => {
    let calls = 0;
    const rev = createRevenue({ all: () => { calls++; return rows; } } as any, () => "");
    const snap = rev.revenueSnapshot();
    expect(calls).toBe(1);
    expect(snap.totals).toEqual(rev.revenueTotals());
    expect(snap.by_month).toEqual(rev.revenueMonthly());
    expect(snap.by_client).toEqual(rev.revenueByClient());
    expect(snap.overdue).toEqual(rev.revenueOverdue());
    expect(snap.overdue).toHaveLength(1);
    expect(snap.overdue[0].number).toBe("TEST-002");
  });
});
