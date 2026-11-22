/** #627: client contact details on the PDF Bill-to block — the address
 * (multi-line) and email render under the client name in the PDF bytes;
 * nothing extra renders when the record has none. */
import { describe, expect, test } from "bun:test";
import { invoicePdf, type PdfInvoice } from "./pdf.ts";

const base: PdfInvoice = {
  number: "INV-0001", status: "sent", clientName: "Acme",
  issueDate: "2026-09-01", dueDate: "2026-09-30",
  items: [], subtotal: 0, tax: 0, taxRate: 0, total: 0, notes: "",
};

function pdfText(inv: PdfInvoice): string {
  return Buffer.from(invoicePdf(inv)).toString("latin1");
}

describe("#627: PDF Bill-to block shows client address and email", () => {
  test("address lines and email land in the PDF under the client name", () => {
    const text = pdfText({
      ...base,
      clientAddress: "2643 Morningside Dr\nClearwater, FL 33759",
      clientEmail: "ap@bytebot.io",
    });
    expect(text).toContain("Acme");
    expect(text).toContain("2643 Morningside Dr");
    expect(text).toContain("Clearwater, FL 33759");
    expect(text).toContain("ap@bytebot.io");
    expect(text.indexOf("Clearwater, FL 33759")).toBeLessThan(text.indexOf("ap@bytebot.io"));
  });

  test("no extra text when the client has no contact details", () => {
    const text = pdfText(base);
    expect(text).toContain("Acme");
    expect(text).not.toContain("Morningside");
    expect(text).not.toContain("ap@bytebot.io");
  });
});

/** #637: From block mirrors the Bill-to order — name, address lines,
 * then email last. */
describe("#637: PDF From block prints email below the address", () => {
  test("email lands after the address lines in the PDF bytes", () => {
    const text = pdfText({
      ...base,
      fromName: "Triston Armstrong",
      fromEmail: "triston@klectr.dev",
      fromAddress: "2498 kelly rd.\nHolladay Tn, 38341",
    });
    expect(text).toContain("Triston Armstrong");
    expect(text).toContain("2498 kelly rd.");
    expect(text).toContain("Holladay Tn, 38341");
    expect(text).toContain("triston@klectr.dev");
    expect(text.indexOf("Holladay Tn, 38341")).toBeLessThan(text.indexOf("triston@klectr.dev"));
  });

  test("a five-line From address prints every line (#1259)", () => {
    const text = pdfText({
      ...base,
      fromName: "Test Studio",
      fromAddress: "123 Main St\nSuite 200\nBuilding B\nSpringfield, IL 62701\nUSA",
    });
    for (const line of ["123 Main St", "Suite 200", "Building B", "Springfield, IL 62701", "USA"]) {
      expect(text).toContain(line);
    }
  });
});

/** #687: paid invoices have nothing left due — the grand-total row reads
 * TOTAL instead of TOTAL DUE. #859: same for drafts — a draft was never
 * sent, so only a sent invoice reads TOTAL DUE. */
describe("#687/#859: PDF grand-total label drops DUE unless sent", () => {
  test("paid invoice prints TOTAL, not TOTAL DUE", () => {
    const text = pdfText({ ...base, status: "paid", total: 2880 });
    expect(text).toContain("TOTAL");
    expect(text).not.toContain("TOTAL DUE");
  });

  test("draft invoice prints TOTAL, not TOTAL DUE", () => {
    const text = pdfText({ ...base, status: "draft", total: 150 });
    expect(text).toContain("TOTAL");
    expect(text).not.toContain("TOTAL DUE");
  });

  test("sent invoice still prints TOTAL DUE", () => {
    const text = pdfText({ ...base, status: "sent", total: 1757.5 });
    expect(text).toContain("TOTAL DUE");
  });
});

/** #831: the PDF status badge agrees with the list's status pill — a draft
 *  was never sent, so it reads DRAFT on neutral gray instead of the amber
 *  UNPAID reserved for sent invoices awaiting payment. */
describe("#831: PDF status badge reads DRAFT for drafts", () => {
  test("draft invoice prints DRAFT, not UNPAID", () => {
    const text = pdfText({ ...base, status: "draft" });
    expect(text).toContain("DRAFT");
    expect(text).not.toContain("UNPAID");
  });

  /* The badge only adds what the page doesn't say: no badge on a sent,
     not-late invoice (its due date is under the total); OVERDUE when late;
     UNPAID only with no due date. */
  test("sent invoice: no badge until late, OVERDUE when late, UNPAID with no due date", () => {
    const sent = pdfText({ ...base, status: "sent" });
    expect(sent).not.toMatch(/\((?:DUE [A-Z]{3} \d+|UNPAID|OVERDUE)\) Tj/);
    expect(pdfText({ ...base, status: "sent", overdue: true })).toContain("(OVERDUE) Tj");
    expect(pdfText({ ...base, status: "sent", dueDate: null })).toContain("(UNPAID) Tj");
  });

  test("a sent invoice states its due date exactly once, under the total", () => {
    const text = pdfText({ ...base, status: "sent" });
    expect(text).toContain("(Due by Sep 30, 2026) Tj");
    expect(text.match(/Sep 30/g)!.length).toBe(1);
  });

  test("drafts and paid invoices keep Due in the dates line (they have no Due by line)", () => {
    expect(pdfText({ ...base, status: "draft" })).toContain("Due Sep 30, 2026");
    expect(pdfText({ ...base, status: "paid" })).toContain("Due Sep 30, 2026");
  });

  test("paid invoice still prints PAID", () => {
    const text = pdfText({ ...base, status: "paid" });
    expect(text).toContain("PAID");
  });
});

/** #875: paid invoices have nothing due — the PDF drops the PAYMENT TERMS
 *  block, like the pay-online link (#639). */
describe("#875: PDF drops the payment-terms block when paid", () => {
  const terms = "Payment is due within 30 days of the zinvoice date.";

  test("sent PDF keeps the terms block", () => {
    const text = pdfText({ ...base, terms });
    expect(text).toContain(terms);
  });

  test("paid PDF drops the terms block", () => {
    const text = pdfText({ ...base, status: "paid", terms });
    expect(text).not.toContain(terms);
  });
});

/** #899: the invoice PDF grows a second page — a bar chart of the tracked
 *  time behind the invoice, per day. No breakdown data, no second page. */
describe("#899: PDF second page shows the time-breakdown chart", () => {
  const days = [
    { date: "2026-09-08", hours: 7 },
    { date: "2026-09-09", hours: 2.75 },
    { date: "2026-09-10", hours: 6.75 },
  ];

  test("chart page renders when per-day breakdown data is present", () => {
    const text = pdfText({ ...base, timeBreakdown: days });
    expect(text).toContain("/Count 2");
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("(TIME BREAKDOWN) Tj");
    expect(text).toContain("Tracked time by day");
    expect(text).toContain("Sep 8");
  });

  test("#1049: timeBreakdownTotal overrides the per-day sum in the header", () => {
    const text = pdfText({ ...base, timeBreakdown: days, timeBreakdownTotal: 16.49 });
    expect(text).toContain("16h 29m total");
    expect(text).not.toContain("16h 30m total");
  });

  test("#1265: billing HOURS column prints decimal hours at 2dp", () => {
    const text = pdfText({ ...base, items: [{ description: "Work", hours: 2.5, rate: 40, amount: 100 }] });
    expect(text).toContain("2.50");
  });

  test("no second page without breakdown data", () => {
    const text = pdfText(base);
    expect(text).toContain("/Count 1");
    expect(text).toContain("Page 1 of 1");
    expect(text).not.toContain("TIME BREAKDOWN");
  });

  test("empty breakdown renders no second page", () => {
    const text = pdfText({ ...base, timeBreakdown: [] });
    expect(text).toContain("/Count 1");
    expect(text).not.toContain("TIME BREAKDOWN");
  });
});

/** Client-facing PDF content: the pay link is labelled by what it can do,
 *  the business's payment instructions are printed, descriptions wrap
 *  instead of truncating, and caps labels are real words (tracked with Tc). */
describe("PDF content fixes", () => {
  const sent = { ...base, payUrl: "https://zimer.example/i/tok", terms: "Payment is due within 30 days of the invoice date." };

  test("no card link: the URL is labelled VIEW ONLINE, never PAY ONLINE", () => {
    const text = pdfText(sent);
    expect(text).toContain("(VIEW ONLINE) Tj");
    expect(text).not.toContain("PAY ONLINE");
  });

  test("with a card link the label is PAY ONLINE", () => {
    expect(pdfText({ ...sent, payByCard: true })).toContain("(PAY ONLINE) Tj");
  });

  test("payment instructions print under HOW TO PAY, line by line, on unpaid invoices only", () => {
    const withHow = { ...sent, paymentInstructions: "Bank transfer to Northstar Studio, acct ending 4821.\nOr mail a check to 1 Main St." };
    const text = pdfText(withHow);
    expect(text).toContain("(HOW TO PAY) Tj");
    expect(text).toContain("acct ending 4821.");
    expect(text).toContain("Or mail a check to 1 Main St.");
    expect(pdfText({ ...withHow, status: "paid" })).not.toContain("HOW TO PAY");
  });

  test("long descriptions wrap onto more lines — every word survives, no ellipsis", () => {
    const desc = "Brand refresh — logo exploration, type system, colour palette and usage guidelines";
    const text = pdfText({ ...base, items: [{ description: desc, hours: 12.25, rate: 120, amount: 1470, dateFrom: null, dateTo: null }] });
    for (const w of ["exploration,", "palette", "usage", "guidelines"]) expect(text).toContain(w);
    expect(text).not.toContain("...)");
  });

  test("caps labels are whole words with character spacing, not letters separated by spaces", () => {
    const text = pdfText({ ...sent, items: [{ description: "x", hours: 1, rate: 1, amount: 1, dateFrom: null, dateTo: null }], notes: "n", fromName: "Northstar" });
    for (const l of ["BILL TO", "FROM", "DATE", "DESCRIPTION", "HOURS", "RATE", "AMOUNT", "PAYMENT TERMS", "NOTES"]) expect(text).toContain(`(${l}) Tj 0 Tc`);
    expect(text).not.toMatch(/\((?:[A-Z] ){3,}/);
  });
});

/** Layout polish: logo, shorter band, real dashes, aligned totals, due line. */
describe("PDF layout polish", () => {
  const sent = { ...base, items: [{ description: "Website rebuild — homepage", hours: 2, rate: 100, amount: 200, dateFrom: "2026-09-08", dateTo: "2026-09-12" }], subtotal: 200, total: 200 };

  test("the brand logo is drawn in the header (resolve was never imported)", () => {
    expect(pdfText(sent)).toMatch(/ RG [\d.]+ w 1 J 1 j/);
  });

  test("the header band is 104pt, not 148pt", () => {
    expect(pdfText(sent)).toContain("0.0 688.0 612.0 104.0 re f");
  });

  test("fonts are WinAnsi and dashes print as dashes", () => {
    const text = pdfText(sent);
    expect(text).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(text).toContain("(Sep 8 \\226 Sep 12) Tj");
    expect(text).toContain("(Website rebuild \\227 homepage) Tj");
    expect(text).toContain("\\267 Generated by Zimer");
  });

  test("the total's tint stops at the table edge and its value sits in the AMOUNT column", () => {
    const text = pdfText({ ...sent, status: "sent" });
    const tint = text.match(/1\.000 0\.961 0\.882 rg ([\d.]+) [\d.]+ ([\d.]+) [\d.]+ re f/)!;
    expect(Number(tint[1]) + Number(tint[2])).toBeCloseTo(556, 0);
  });

  test("'Due by' sits under the amount due on sent invoices", () => {
    expect(pdfText({ ...sent, status: "sent" })).toContain("(Due by Sep 30, 2026) Tj");
    expect(pdfText({ ...sent, status: "sent", overdue: true })).toContain("(Was due Sep 30, 2026) Tj");
    expect(pdfText({ ...sent, status: "paid" })).not.toContain("Due by");
  });
});
