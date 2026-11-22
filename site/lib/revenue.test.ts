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
  const ymdDaysAgo = (n: number) => {
    const d = new Date(Date.now() - n * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const old = new Date(); old.setMonth(old.getMonth() - 13);
  const oldYm = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, "0")}`;
  const rows = [
    row("sent", 100.10, { tax_rate: 10 }),
    row("paid", 50.25, { id: 2, number: "TEST-002", client_id: 8, client_name: "Beta" }),
    row("draft", 999, { id: 3, number: "TEST-003" }),
    row("sent", 75.50, { id: 4, number: "TEST-004", client_id: null, client_name: null }),
    row("sent", 40, { id: 5, number: "TEST-005", client_id: 8, client_name: "Beta", issue_date: `${oldYm}-15` }),
    row("sent", 200, { id: 6, number: "TEST-006", due_date: ymdDaysAgo(40), client_payment_terms: "net_30" }),
    row("sent", 300, { id: 7, number: "TEST-007", client_id: 8, client_name: "Beta", due_date: ymdDaysAgo(10), client_payment_terms: "net_30" }),
  ];

  test("one row fetch for all four figures", () => {
    let calls = 0;
    /* Fresh row copies per fetch, like SQLite — a helper mutating its
       input would contaminate the isolated calls and fail equivalence. */
    const rev = createRevenue({ all: () => { calls++; return rows.map(r => ({ ...r })); } } as any, () => "");
    const snap = rev.revenueSnapshot();
    expect(calls).toBe(1);
    expect(snap.totals).toEqual(rev.revenueTotals());
    expect(snap.by_month).toEqual(rev.revenueMonthly());
    expect(snap.by_client).toEqual(rev.revenueByClient());
    expect(snap.overdue).toEqual(rev.revenueOverdue());
    /* Spot checks the equivalence oracle cannot make on its own. */
    expect(snap.totals.invoiced).toBe(775.86);
    expect(snap.by_client.map(c => c.client_id)).toEqual([8, 7]);
    expect(snap.overdue.map(o => o.number)).toEqual(["TEST-006", "TEST-007"]);
    expect(snap.overdue[0].bucket).toBe("31+");
  });
});
