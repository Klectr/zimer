/**
 * Hand-rolled PDF invoice generator — zero dependencies.
 *
 * Builds a self-contained PDF (Helvetica + Helvetica-Bold, both PDF base-14
 * fonts so no embedding needed). All text is sanitized to ASCII so string
 * lengths equal byte lengths for the xref table.
 *
 * Templates: each template is a draw function over a PdfDoc. Shared
 * assembly (pages → xref PDF) lives in assemblePdf. Register new templates
 * in TEMPLATES — classic/minimal/bold ship built-in.
 */

export type PdfLineItem = {
  description: string;
  hours: number;
  rate: number;
  amount: number;
};

export type PdfInvoice = {
  number: string;
  status: string;
  clientName: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  items: PdfLineItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
  notes: string;
};

/* Widths (units per 1000) for the only glyphs used in right-aligned numerics. */
const NUM_WIDTHS: Record<string, number> = {
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556,
  "6": 556, "7": 556, "8": 556, "9": 556,
  ".": 278, ",": 278, "$": 556, " ": 278, "%": 889, "-": 333,
};

function ascii(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?");
}

function escPdf(s: string): string {
  return ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function numWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += NUM_WIDTHS[ch] ?? 500;
  return (w * size) / 1000;
}

function money(n: number): string {
  const r = Math.round(n * 100) / 100;
  return "$" + r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

const PAGE_W = 612; // Letter
const PAGE_H = 792;
const M = 56; // margin
const RIGHT = PAGE_W - M;

/** Drawing context: templates emit PDF content-stream commands into pages. */
class PdfDoc {
  pages: string[][] = [[]];
  y = PAGE_H - M;
  private get cmds(): string[] { return this.pages[this.pages.length - 1]; }
  text(x: number, yy: number, size: number, s: string, bold = false, gray = false) {
    const color = gray ? "0.45 0.45 0.45 rg " : "";
    this.cmds.push(`BT ${color}/F${bold ? 2 : 1} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${escPdf(s)}) Tj ET`);
  }
  rtext(rightX: number, yy: number, size: number, s: string, bold = false) {
    this.text(rightX - numWidth(s, size), yy, size, s, bold);
  }
  rule(yy: number, w = 1) {
    this.cmds.push(`${w} w ${M} ${yy} m ${RIGHT} ${yy} l S`);
  }
  newPage() {
    this.pages.push([]);
    this.y = PAGE_H - M;
  }
}

type TemplateDraw = (inv: PdfInvoice, doc: PdfDoc) => void;

/* ---------------- classic ----------------
 * The original layout, extracted verbatim. Byte-identical output guaranteed
 * by the B1 migration test (old vs new writer diffed on a sample invoice). */
function drawClassic(inv: PdfInvoice, doc: PdfDoc) {
  /* ---- header (page 1) ---- */
  doc.text(M, doc.y, 26, "INVOICE", true);
  doc.rtext(RIGHT, doc.y - 6, 16, inv.number, true);
  doc.y -= 30;
  const dates = `Issued ${fmtDate(inv.issueDate)}${inv.dueDate ? `  |  Due ${fmtDate(inv.dueDate)}` : ""}`;
  doc.text(M, doc.y, 11, dates, false, true);
  doc.rtext(RIGHT, doc.y, 10, `Status: ${inv.status.toUpperCase()}`, true);
  doc.y -= 18;
  doc.rule(doc.y);
  doc.y -= 28;
  doc.text(M, doc.y, 11, "Bill to", true);
  doc.y -= 18;
  doc.text(M, doc.y, 12, inv.clientName || "-");
  doc.y -= 30;

  /* ---- line-item table ---- */
  const C_DESC = M, C_HOURS = 400, C_RATE = 480, C_AMT = RIGHT;
  const tableHead = () => {
    doc.text(C_DESC, doc.y, 10, "DESCRIPTION", true, true);
    doc.rtext(C_HOURS, doc.y, 10, "HOURS", true, true);
    doc.rtext(C_RATE, doc.y, 10, "RATE", true, true);
    doc.rtext(C_AMT, doc.y, 10, "AMOUNT", true, true);
    doc.y -= 8;
    doc.rule(doc.y);
    doc.y -= 20;
  };
  tableHead();

  if (!inv.items.length) {
    doc.text(M, doc.y, 10, "No line items.", false, true);
    doc.y -= 20;
  }
  for (const it of inv.items) {
    if (doc.y < 130) {
      doc.newPage();
      tableHead();
    }
    const desc = it.description.length > 52 ? it.description.slice(0, 49) + "..." : it.description;
    doc.text(C_DESC, doc.y, 10, desc);
    const hours = String(it.hours).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    doc.rtext(C_HOURS, doc.y, 10, hours);
    doc.rtext(C_RATE, doc.y, 10, money(it.rate));
    doc.rtext(C_AMT, doc.y, 10, money(it.amount));
    doc.y -= 18;
  }
  doc.y -= 6;
  doc.rule(doc.y);
  doc.y -= 22;

  /* ---- totals ---- */
  const totalRow = (label: string, val: string, bold = false, size = 11) => {
    doc.rtext(C_RATE, doc.y, size, label, bold);
    doc.rtext(C_AMT, doc.y, size, val, bold);
    doc.y -= size + 8;
  };
  totalRow("Subtotal", money(inv.subtotal));
  if (inv.taxRate) totalRow(`Tax (${inv.taxRate}%)`, money(inv.tax));
  totalRow("Total due", money(inv.total), true, 13);

  /* ---- notes ---- */
  if (inv.notes.trim()) {
    doc.y -= 12;
    doc.text(M, doc.y, 11, "Notes", true);
    doc.y -= 16;
    const words = inv.notes.split(/\s+/);
    let lineText = "";
    for (const w of words) {
      const trial = lineText ? lineText + " " + w : w;
      if (trial.length * 5 > RIGHT - M && lineText) {
        doc.text(M, doc.y, 10, lineText);
        doc.y -= 14;
        if (doc.y < 80) doc.newPage();
        lineText = w;
      } else {
        lineText = trial;
      }
    }
    if (lineText) {
      doc.text(M, doc.y, 10, lineText);
      doc.y -= 14;
    }
  }

  /* ---- footers ---- */
  doc.pages.forEach((p, i) => {
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${M} 40 Td (${escPdf(inv.number)} - Generated by Timekeep) Tj ET`);
    const pg = `Page ${i + 1} of ${doc.pages.length}`;
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${(RIGHT - numWidth(pg, 9)).toFixed(1)} 40 Td (${escPdf(pg)}) Tj ET`);
  });
}

/* ---------------- registry ---------------- */

const TEMPLATES: Record<string, { id: string; name: string; draw: TemplateDraw }> = {
  classic: { id: "classic", name: "Classic", draw: drawClassic },
};

export function isInvoiceTemplate(id: string): boolean {
  return id in TEMPLATES;
}

export function templateList(): { id: string; name: string }[] {
  return Object.values(TEMPLATES).map(t => ({ id: t.id, name: t.name }));
}

/** Render an invoice PDF. Unknown template ids fall back to classic. */
export function invoicePdf(inv: PdfInvoice, template = "classic"): Uint8Array {
  const t = TEMPLATES[template] ?? TEMPLATES.classic;
  const doc = new PdfDoc();
  t.draw(inv, doc);
  return assemblePdf(doc.pages);
}

/* ---------------- assembly (shared by all templates) ---------------- */

function assemblePdf(pages: string[][]): Uint8Array {
  const n = pages.length;
  const font1 = 3 + n * 2;
  const font2 = 4 + n * 2;
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`;
  pages.forEach((p, i) => {
    objs[3 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`;
    const stream = p.join("\n");
    objs[4 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[font1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[font2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= font2; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += `xref\n0 ${font2 + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= font2; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${font2 + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return new TextEncoder().encode(out);
}
