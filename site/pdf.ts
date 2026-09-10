/**
 * Minimal hand-rolled PDF invoice generator — zero dependencies.
 *
 * Builds a single self-contained PDF (Helvetica + Helvetica-Bold, both are
 * PDF base-14 fonts so no embedding needed). All text is sanitized to ASCII
 * so string lengths equal byte lengths for the xref table.
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

export function invoicePdf(inv: PdfInvoice): Uint8Array {
  const pages: string[][] = [[]];
  let cmds = pages[0];
  let y = PAGE_H - M;

  const text = (x: number, yy: number, size: number, s: string, bold = false, gray = false) => {
    const color = gray ? "0.45 0.45 0.45 rg " : "";
    cmds.push(`BT ${color}/F${bold ? 2 : 1} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${escPdf(s)}) Tj ET`);
  };
  const rtext = (rightX: number, yy: number, size: number, s: string, bold = false) => {
    text(rightX - numWidth(s, size), yy, size, s, bold);
  };
  const rule = (yy: number, w = 1) => {
    cmds.push(`${w} w ${M} ${yy} m ${RIGHT} ${yy} l S`);
  };
  const newPage = () => {
    pages.push([]);
    cmds = pages[pages.length - 1];
    y = PAGE_H - M;
  };

  /* ---- header (page 1) ---- */
  text(M, y, 26, "INVOICE", true);
  rtext(RIGHT, y - 6, 16, inv.number, true);
  y -= 30;
  const dates = `Issued ${fmtDate(inv.issueDate)}${inv.dueDate ? `  |  Due ${fmtDate(inv.dueDate)}` : ""}`;
  text(M, y, 11, dates, false, true);
  rtext(RIGHT, y, 10, `Status: ${inv.status.toUpperCase()}`, true);
  y -= 18;
  rule(y);
  y -= 28;
  text(M, y, 11, "Bill to", true);
  y -= 18;
  text(M, y, 12, inv.clientName || "-");
  y -= 30;

  /* ---- line-item table ---- */
  const C_DESC = M, C_HOURS = 400, C_RATE = 480, C_AMT = RIGHT;
  const tableHead = () => {
    text(C_DESC, y, 10, "DESCRIPTION", true, true);
    rtext(C_HOURS, y, 10, "HOURS", true, true);
    rtext(C_RATE, y, 10, "RATE", true, true);
    rtext(C_AMT, y, 10, "AMOUNT", true, true);
    y -= 8;
    rule(y);
    y -= 20;
  };
  tableHead();

  if (!inv.items.length) {
    text(M, y, 10, "No line items.", false, true);
    y -= 20;
  }
  for (const it of inv.items) {
    if (y < 130) {
      newPage();
      tableHead();
    }
    const desc = it.description.length > 52 ? it.description.slice(0, 49) + "..." : it.description;
    text(C_DESC, y, 10, desc);
    const hours = String(it.hours).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    rtext(C_HOURS, y, 10, hours);
    rtext(C_RATE, y, 10, money(it.rate));
    rtext(C_AMT, y, 10, money(it.amount));
    y -= 18;
  }
  y -= 6;
  rule(y);
  y -= 22;

  /* ---- totals ---- */
  const totalRow = (label: string, val: string, bold = false, size = 11) => {
    rtext(C_RATE, y, size, label, bold);
    rtext(C_AMT, y, size, val, bold);
    y -= size + 8;
  };
  totalRow("Subtotal", money(inv.subtotal));
  if (inv.taxRate) totalRow(`Tax (${inv.taxRate}%)`, money(inv.tax));
  totalRow("Total due", money(inv.total), true, 13);

  /* ---- notes ---- */
  if (inv.notes.trim()) {
    y -= 12;
    text(M, y, 11, "Notes", true);
    y -= 16;
    const words = inv.notes.split(/\s+/);
    let lineText = "";
    for (const w of words) {
      const trial = lineText ? lineText + " " + w : w;
      if (trial.length * 5 > RIGHT - M && lineText) {
        text(M, y, 10, lineText);
        y -= 14;
        if (y < 80) newPage();
        lineText = w;
      } else {
        lineText = trial;
      }
    }
    if (lineText) {
      text(M, y, 10, lineText);
      y -= 14;
    }
  }

  /* ---- footers ---- */
  pages.forEach((p, i) => {
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${M} 40 Td (${escPdf(inv.number)} - Generated by Timekeep) Tj ET`);
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${(RIGHT - numWidth(pg, 9)).toFixed(1)} 40 Td (${escPdf(pg)}) Tj ET`);
  });

  /* ---- assemble ---- */
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
