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

  test("sent invoice still prints UNPAID", () => {
    const text = pdfText({ ...base, status: "sent" });
    expect(text).toContain("UNPAID");
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
    expect(text).toContain("T I M E   B R E A K D O W N");
    expect(text).toContain("Tracked time by day");
    expect(text).toContain("Sep 8");
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
