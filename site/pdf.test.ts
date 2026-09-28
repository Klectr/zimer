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
      fromEmail: "triston@hey.com",
      fromAddress: "2498 kelly rd.\nHolladay Tn, 38341",
    });
    expect(text).toContain("Triston Armstrong");
    expect(text).toContain("2498 kelly rd.");
    expect(text).toContain("Holladay Tn, 38341");
    expect(text).toContain("triston@hey.com");
    expect(text.indexOf("Holladay Tn, 38341")).toBeLessThan(text.indexOf("triston@hey.com"));
  });
});
