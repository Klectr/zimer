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
  fromName?: string; // #233: business profile, shown by the modern template
  fromEmail?: string;
  fromAddress?: string;
};

/* Widths (units per 1000) for the only glyphs used in right-aligned numerics. */
const NUM_WIDTHS: Record<string, number> = {
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556,
  "6": 556, "7": 556, "8": 556, "9": 556,
  ".": 278, ",": 278, "$": 556, " ": 278, "%": 889, "-": 333,
};

/* #233: map common typographic characters to ASCII equivalents instead of
   letting them degrade to "?". Anything else non-ASCII still becomes "?". */
const TYPO_MAP: Record<string, string> = {
  "—": "-", "–": "-", "−": "-",
  "\u201c": '"', "\u201d": '"', "„": '"',
  "\u2018": "'", "\u2019": "'", "‚": "'",
  "…": "...", "•": "-", "·": "-", " ": " ",
};

function ascii(s: string): string {
  let out = "";
  for (const ch of s) out += TYPO_MAP[ch] ?? (/[\x20-\x7e]/.test(ch) ? ch : "?");
  return out;
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
  text(x: number, yy: number, size: number, s: string, bold = false, gray = false, rgb?: [number, number, number]) {
    /* #233: always emit an explicit fill color — fill() leaves the graphics
       state dirty, and text would otherwise inherit the last fill color. */
    const fillRgb = Array.isArray(rgb) ? rgb : null;
    const color = fillRgb ? `${fillRgb[0].toFixed(3)} ${fillRgb[1].toFixed(3)} ${fillRgb[2].toFixed(3)} rg ` : gray ? "0.45 0.45 0.45 rg " : "0 0 0 rg ";
    this.cmds.push(`BT ${color}/F${bold ? 2 : 1} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${escPdf(s)}) Tj ET`);
  }
  rtext(rightX: number, yy: number, size: number, s: string, bold = false, gray: boolean | [number, number, number] = false) {
    this.text(rightX - numWidth(s, size), yy, size, s, bold, gray === true, Array.isArray(gray) ? gray : undefined);
  }
  /** #233: filled rectangle — bands, zebra rows, badges, tinted totals. */
  fill(x: number, yy: number, w: number, h: number, rgb: [number, number, number]) {
    this.cmds.push(`${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)} rg ${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
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
  doc.rtext(RIGHT, doc.y, 10, `Status: ${(inv.status === "paid" ? "PAID" : "UNPAID")}`, true);
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

/* ---------------- minimal ----------------
 * Less ink, more air: small gray labels, thin rules, regular weights. */
function drawMinimal(inv: PdfInvoice, doc: PdfDoc) {
  doc.text(M, doc.y, 12, "Invoice", false, true);
  doc.rtext(RIGHT, doc.y, 12, inv.number);
  doc.y -= 20;
  const dates = `Issued ${fmtDate(inv.issueDate)}${inv.dueDate ? `  ·  Due ${fmtDate(inv.dueDate)}` : ""}`;
  doc.text(M, doc.y, 10, dates, false, true);
  doc.rtext(RIGHT, doc.y, 10, (inv.status === "paid" ? "PAID" : "UNPAID"), false, true);
  doc.y -= 14;
  doc.rule(doc.y, 0.5);
  doc.y -= 26;
  doc.text(M, doc.y, 10, inv.clientName || "-", false, true);
  doc.y -= 30;

  const C_DESC = M, C_HOURS = 400, C_RATE = 480, C_AMT = RIGHT;
  const tableHead = () => {
    doc.text(C_DESC, doc.y, 9, "Description", false, true);
    doc.rtext(C_HOURS, doc.y, 9, "Hours", false, true);
    doc.rtext(C_RATE, doc.y, 9, "Rate", false, true);
    doc.rtext(C_AMT, doc.y, 9, "Amount", false, true);
    doc.y -= 8;
    doc.rule(doc.y, 0.5);
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
    const desc = it.description.length > 60 ? it.description.slice(0, 57) + "..." : it.description;
    doc.text(C_DESC, doc.y, 10, desc);
    const hours = String(it.hours).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    doc.rtext(C_HOURS, doc.y, 10, hours);
    doc.rtext(C_RATE, doc.y, 10, money(it.rate));
    doc.rtext(C_AMT, doc.y, 10, money(it.amount));
    doc.y -= 20;
  }
  doc.y -= 4;
  doc.rule(doc.y, 0.5);
  doc.y -= 22;

  const totalRow = (label: string, val: string, bold = false, size = 10) => {
    doc.text(C_RATE - numWidth(label, size), doc.y, size, label, bold, true);
    doc.rtext(C_AMT, doc.y, size, val, bold);
    doc.y -= size + 8;
  };
  totalRow("Subtotal", money(inv.subtotal));
  if (inv.taxRate) totalRow(`Tax (${inv.taxRate}%)`, money(inv.tax));
  totalRow("Total due", money(inv.total), true, 12);

  if (inv.notes.trim()) {
    doc.y -= 12;
    doc.text(M, doc.y, 10, "Notes", false, true);
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

  doc.pages.forEach((p, i) => {
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${M} 40 Td (${escPdf(inv.number)} - Generated by Timekeep) Tj ET`);
    const pg = `Page ${i + 1} of ${doc.pages.length}`;
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${(RIGHT - numWidth(pg, 9)).toFixed(1)} 40 Td (${escPdf(pg)}) Tj ET`);
  });
}

/* ---------------- bold ----------------
 * Heavy and confident: big bold title, thick rules, bold totals. */
function drawBold(inv: PdfInvoice, doc: PdfDoc) {
  doc.text(M, doc.y, 30, "INVOICE", true);
  doc.rtext(RIGHT, doc.y - 8, 18, inv.number, true);
  doc.y -= 36;
  const dates = `Issued ${fmtDate(inv.issueDate)}${inv.dueDate ? `  |  Due ${fmtDate(inv.dueDate)}` : ""}`;
  doc.text(M, doc.y, 11, dates, true, true);
  doc.rtext(RIGHT, doc.y, 11, (inv.status === "paid" ? "PAID" : "UNPAID"), true, true);
  doc.y -= 16;
  doc.rule(doc.y, 2.5);
  doc.y -= 28;
  doc.text(M, doc.y, 10, "BILL TO", true, true);
  doc.y -= 18;
  doc.text(M, doc.y, 14, inv.clientName || "-", true);
  doc.y -= 30;

  const C_DESC = M, C_HOURS = 400, C_RATE = 480, C_AMT = RIGHT;
  const tableHead = () => {
    doc.text(C_DESC, doc.y, 10, "DESCRIPTION", true);
    doc.rtext(C_HOURS, doc.y, 10, "HOURS", true);
    doc.rtext(C_RATE, doc.y, 10, "RATE", true);
    doc.rtext(C_AMT, doc.y, 10, "AMOUNT", true);
    doc.y -= 8;
    doc.rule(doc.y, 2);
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
    doc.text(C_DESC, doc.y, 10.5, desc);
    const hours = String(it.hours).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    doc.rtext(C_HOURS, doc.y, 10.5, hours);
    doc.rtext(C_RATE, doc.y, 10.5, money(it.rate));
    doc.rtext(C_AMT, doc.y, 10.5, money(it.amount), true);
    doc.y -= 19;
  }
  doc.y -= 6;
  doc.rule(doc.y, 1);
  doc.y -= 22;

  const totalRow = (label: string, val: string, bold = false, size = 11) => {
    doc.rtext(C_RATE, doc.y, size, label, bold);
    doc.rtext(C_AMT, doc.y, size, val, bold);
    doc.y -= size + 8;
  };
  totalRow("Subtotal", money(inv.subtotal));
  if (inv.taxRate) totalRow(`Tax (${inv.taxRate}%)`, money(inv.tax));
  doc.rule(doc.y + 4, 2);
  doc.y -= 8;
  /* #233: at 14pt "TOTAL DUE" is wider than the C_RATE..C_AMT gap, so it
     collided with the amount — right-align the label clear of the value. */
  const grandVal = money(inv.total);
  doc.text(C_AMT - numWidth(grandVal, 14) - 16 - capsWidth("TOTAL DUE", 14), doc.y, 14, "TOTAL DUE", true);
  doc.rtext(C_AMT, doc.y, 14, grandVal, true);
  doc.y -= 22;

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

  doc.pages.forEach((p, i) => {
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${M} 40 Td (${escPdf(inv.number)} - Generated by Timekeep) Tj ET`);
    const pg = `Page ${i + 1} of ${doc.pages.length}`;
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${(RIGHT - numWidth(pg, 9)).toFixed(1)} 40 Td (${escPdf(pg)}) Tj ET`);
  });
}

/* ---------------- modern (#233) ----------------
 * Dark header band with a gold accent rule, status as a filled badge,
 * letter-spaced labels, zebra-striped line items, tinted total row. */
const GOLD: [number, number, number] = [0.949, 0.757, 0.306]; // #f2c14e
const INK: [number, number, number] = [0.11, 0.11, 0.13];
const PAPER: [number, number, number] = [0.965, 0.965, 0.967];
const TINT: [number, number, number] = [1.0, 0.961, 0.882];
const WHITE: [number, number, number] = [1, 1, 1];
const SOFT: [number, number, number] = [0.72, 0.72, 0.74];

/* Width estimate for letter-spaced BOLD CAPS labels: base-14 Helvetica-Bold
   caps average ~680/1000, well above numWidth's 500 fallback. */
function capsWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += ch === " " ? 278 : /[A-Z]/.test(ch) ? 680 : 500;
  return (w * size) / 1000;
}

function statusBadge(doc: PdfDoc, rightX: number, yy: number, paid: boolean) {
  const label = paid ? "PAID" : "UNPAID";
  const pw = label.length * 6.4 + 20, ph = 20;
  const x = rightX - pw;
  doc.fill(x, yy - 6, pw, ph, paid ? [0.16, 0.55, 0.28] : GOLD);
  doc.text(x + 10, yy, 9, label, true, false, paid ? WHITE : INK);
}

function drawModern(inv: PdfInvoice, doc: PdfDoc) {
  /* ---- dark header band (page 1) ---- */
  const bandH = 148;
  doc.fill(0, PAGE_H - bandH, PAGE_W, bandH, INK);
  doc.text(M, PAGE_H - 62, 30, "INVOICE", true, false, WHITE);
  doc.fill(M, PAGE_H - 74, 72, 3.5, GOLD);
  doc.rtext(RIGHT, PAGE_H - 52, 15, inv.number, true, WHITE);
  const dates = `Issued ${fmtDate(inv.issueDate)}${inv.dueDate ? `  |  Due ${fmtDate(inv.dueDate)}` : ""}`;
  doc.rtext(RIGHT, PAGE_H - 74, 10, dates, false, SOFT);
  statusBadge(doc, RIGHT, PAGE_H - 108, inv.status === "paid");
  doc.y = PAGE_H - bandH - 36;

  /* ---- from / bill-to ---- */
  const hasFrom = inv.fromName || inv.fromEmail || inv.fromAddress;
  if (hasFrom) {
    doc.text(M, doc.y, 8.5, "F R O M", true, true);
    doc.y -= 17;
    if (inv.fromName) { doc.text(M, doc.y, 12, inv.fromName, true); doc.y -= 16; }
    if (inv.fromEmail) { doc.text(M, doc.y, 10, inv.fromEmail, false, true); doc.y -= 15; }
    if (inv.fromAddress) {
      for (const line of inv.fromAddress.split("\n").slice(0, 3)) {
        if (!line.trim()) continue;
        doc.text(M, doc.y, 10, line.trim(), false, true); doc.y -= 15;
      }
    }
    doc.y -= 20;
  }
  doc.text(M, doc.y, 8.5, "B I L L   T O", true, true);
  doc.y -= 17;
  doc.text(M, doc.y, 13, inv.clientName || "-", true);
  doc.y -= 32;

  /* ---- line-item table ---- */
  const C_DESC = M, C_HOURS = 400, C_RATE = 480, C_AMT = RIGHT;
  const RH = 24;
  const tableHead = () => {
    doc.fill(M, doc.y - 8, RIGHT - M, 24, INK);
    doc.text(C_DESC + 10, doc.y, 9, "D E S C R I P T I O N", true, false, WHITE);
    doc.text(C_HOURS - capsWidth("H O U R S", 9), doc.y, 9, "H O U R S", true, false, WHITE);
    doc.text(C_RATE - capsWidth("R A T E", 9), doc.y, 9, "R A T E", true, false, WHITE);
    doc.text(C_AMT - 10 - capsWidth("A M O U N T", 9), doc.y, 9, "A M O U N T", true, false, WHITE);
    doc.y -= 8 + 24;
  };
  tableHead();

  if (!inv.items.length) {
    doc.text(M + 10, doc.y - 4, 10, "No line items.", false, true);
    doc.y -= RH;
  }
  inv.items.forEach((it, i) => {
    if (doc.y < 150) {
      doc.newPage();
      tableHead();
    }
    if (i % 2 === 1) doc.fill(M, doc.y - 8, RIGHT - M, RH, PAPER);
    const desc = it.description.length > 52 ? it.description.slice(0, 49) + "..." : it.description;
    doc.text(C_DESC + 10, doc.y - 2, 10, desc);
    const hours = String(it.hours).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    doc.rtext(C_HOURS, doc.y - 2, 10, hours);
    doc.rtext(C_RATE, doc.y - 2, 10, money(it.rate));
    doc.rtext(C_AMT - 10, doc.y - 2, 10, money(it.amount));
    doc.y -= RH;
  });
  doc.y -= 10;

  /* ---- totals ---- */
  const totalRow = (label: string, val: string, bold = false, size = 11, tint = false) => {
    if (tint) doc.fill(C_RATE - 150, doc.y - 9, 150 + (RIGHT - C_RATE) + 10, size + 18, TINT);
    /* Right-align the label so it ends clear of the value — at 14pt "TOTAL
       DUE" is wider than the C_RATE..C_AMT gap. */
    const lr = tint ? C_AMT - numWidth(val, size) - 16 : C_RATE;
    doc.text(lr - capsWidth(label, size), doc.y, size, label, bold);
    doc.rtext(C_AMT, doc.y, size, val, bold);
    doc.y -= size + 12;
  };
  totalRow("Subtotal", money(inv.subtotal));
  if (inv.taxRate) totalRow(`Tax (${inv.taxRate}%)`, money(inv.tax));
  doc.y -= 4;
  totalRow("TOTAL DUE", money(inv.total), true, 14, true);

  /* ---- notes ---- */
  if (inv.notes.trim()) {
    doc.y -= 14;
    doc.text(M, doc.y, 8.5, "N O T E S", true, true);
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
  minimal: { id: "minimal", name: "Minimal", draw: drawMinimal },
  bold: { id: "bold", name: "Bold", draw: drawBold },
  modern: { id: "modern", name: "Modern", draw: drawModern },
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
