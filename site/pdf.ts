/**
 * Hand-rolled PDF invoice generator — zero dependencies.
 *
 * Builds a self-contained PDF (Helvetica + Helvetica-Bold, both PDF base-14
 * fonts so no embedding needed). All text is sanitized to ASCII so string
 * lengths equal byte lengths for the xref table.
 *
 * Renders a single invoice design (Modern, #233): dark header band, gold
 * accent rule, status badge, letter-spaced labels, zebra rows, tinted total
 * row. Shared assembly (pages → xref PDF) lives in assemblePdf.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resourcePath } from "./lib/paths.ts"; /* #519 */

export type PdfLineItem = {
  description: string;
  hours: number;
  rate: number;
  amount: number;
  dateFrom?: string | null; // #243: YYYY-MM-DD, per-line billing dates
  dateTo?: string | null;
};

export type PdfInvoice = {
  number: string;
  status: string;
  clientName: string;
  clientAddress?: string; // #627: multi-line, rendered under the name
  clientEmail?: string; // #627: rendered under the address
  issueDate: string; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  hideDue?: boolean; // #295: pay-when-paid has no fixed due date — suppress the due line
  items: PdfLineItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
  notes: string;
  fromName?: string; // #233: business profile, shown by the modern template
  fromEmail?: string;
  fromAddress?: string;
  terms?: string; // #243: plain-language payment terms near the totals
  payUrl?: string; // #243: public invoice URL — the payment instruction
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
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/* #243: short date forms for line items ("Sep 11") and ranges. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDateShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${MONTHS[m - 1]} ${d}`;
}
/** #243: per-line date cell — "Sep 11" or "Aug 31-Sep 11". */
function lineDate(it: PdfLineItem): string {
  if (!it.dateFrom) return "";
  return it.dateTo && it.dateTo !== it.dateFrom
    ? `${fmtDateShort(it.dateFrom)}-${fmtDateShort(it.dateTo)}`
    : fmtDateShort(it.dateFrom);
}
/** #243: simple word-wrap paragraph for short blocks like payment terms. */
function para(doc: PdfDoc, text: string, size: number) {
  let line = "";
  for (const w of text.split(/\s+/)) {
    const trial = line ? line + " " + w : w;
    if (trial.length * size * 0.5 > RIGHT - M && line) {
      doc.text(M, doc.y, size, line);
      doc.y -= size + 4;
      if (doc.y < 80) doc.newPage();
      line = w;
    } else line = trial;
  }
  if (line) { doc.text(M, doc.y, size, line); doc.y -= size + 4; }
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
  /** Push a raw content-stream command (for vector art like the logo). */
  raw(s: string) {
    this.cmds.push(s);
  }
  newPage() {
    this.pages.push([]);
    this.y = PAGE_H - M;
  }
}

/* ---------------- brand logo (#241) ----------------
 * The logo lives in site/static/logo.svg — the single source of truth.
 * Its artwork is stroked paths using absolute M/L/C commands plus one filled
 * circle, which map directly onto PDF path operators (m/l/c + S for strokes,
 * 4-bezier circle + f for the dot). Parsed once and cached; if the SVG ever
 * can't be parsed the invoice simply renders without the mark. */

interface LogoCmd { op: string; pts: number[] }
interface LogoArt { strokeW: number; strokes: LogoCmd[][]; dots: { cx: number; cy: number; r: number }[] }

let logoArt: LogoArt | null | undefined;

function tokenizePath(d: string): LogoCmd[] {
  const toks = d.match(/[MLCZ]|-?\d*\.?\d+/gi) || [];
  const cmds: LogoCmd[] = [];
  const need: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0 };
  for (const t of toks) {
    if (/^[MLCZ]$/i.test(t)) cmds.push({ op: t.toUpperCase(), pts: [] });
    else if (cmds.length) cmds[cmds.length - 1].pts.push(parseFloat(t));
  }
  return cmds.filter(c => (need[c.op] ?? -1) === c.pts.length && c.op !== "Z");
}

function loadLogoArt(): LogoArt | null {
  if (logoArt !== undefined) return logoArt;
  logoArt = null;
  try {
    const svg = readFileSync(
      /* #519: logo ships in the exe-relative resources dir in a compiled binary */
      join(resourcePath("static", resolve(import.meta.dir, "static")), "logo.svg"),
      "utf8",
    );
    const strokeW = parseFloat(svg.match(/stroke-width="([\d.]+)"/)?.[1] || "4") || 4;
    const strokes: LogoCmd[][] = [];
    for (const m of svg.matchAll(/<path\b[^>]*?d="([^"]*)"[^>]*?>/g)) {
      const cmds = tokenizePath(m[1]);
      if (cmds.length) strokes.push(cmds);
    }
    const dots: LogoArt["dots"] = [];
    for (const m of svg.matchAll(/<circle\b[^>]*?>/g)) {
      const tag = m[0];
      const num = (n: string) => { const v = tag.match(new RegExp(`${n}="([\\d.]+)"`))?.[1]; return v === undefined ? null : parseFloat(v); };
      const cx = num("cx"), cy = num("cy"), r = num("r");
      if (cx !== null && cy !== null && r !== null) dots.push({ cx, cy, r });
    }
    if (strokes.length || dots.length) logoArt = { strokeW, strokes, dots };
  } catch {
    /* missing/unparseable logo: invoice renders without the mark */
  }
  return logoArt;
}

/** Draw the brand mark with its top-left at (x, topY), `size` pt tall,
    in the given color. SVG is y-down; PDF is y-up, so Y flips. */
function drawLogo(doc: PdfDoc, x: number, topY: number, size: number, rgb: [number, number, number]) {
  const art = loadLogoArt();
  if (!art) return;
  const s = size / 64;
  const X = (v: number) => (x + s * v).toFixed(2);
  const Y = (v: number) => (topY - s * v).toFixed(2);
  const col = rgb.map(c => c.toFixed(3)).join(" ");
  const parts: string[] = ["q"];
  if (art.strokes.length) {
    parts.push(`${col} RG ${(art.strokeW * s).toFixed(2)} w 1 J 1 j`);
    for (const p of art.strokes) {
      parts.push(p.map(c =>
        c.pts.map((v, i) => (i % 2 === 0 ? X(v) : Y(v))).join(" ") + " " + c.op.toLowerCase()
      ).join(" "));
    }
    parts.push("S");
  }
  for (const d of art.dots) {
    /* filled circle as 4 cubic beziers (kappa = 0.5523) */
    const k = 0.5523 * d.r;
    const seg = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) =>
      `${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} ${X(x3)} ${Y(y3)} ${X(x4)} ${Y(y4)} c`;
    parts.push(`${col} rg ` + seg(d.cx + d.r, d.cy, d.cx + d.r, d.cy + k, d.cx + k, d.cy + d.r, d.cx, d.cy + d.r)
      + " " + seg(d.cx, d.cy + d.r, d.cx - k, d.cy + d.r, d.cx - d.r, d.cy + k, d.cx - d.r, d.cy)
      + " " + seg(d.cx - d.r, d.cy, d.cx - d.r, d.cy - k, d.cx - k, d.cy - d.r, d.cx, d.cy - d.r)
      + " " + seg(d.cx, d.cy - d.r, d.cx + k, d.cy - d.r, d.cx + d.r, d.cy - k, d.cx + d.r, d.cy) + " f");
  }
  parts.push("Q");
  doc.raw(parts.join(" "));
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

/* #831: the PDF badge agrees with the list's status pill — a draft was never
   sent, so it reads DRAFT on a neutral gray instead of the amber UNPAID
   reserved for sent invoices awaiting payment. */
const DRAFT_GRAY: [number, number, number] = [0.62, 0.63, 0.65];
function statusBadge(doc: PdfDoc, rightX: number, yy: number, status: string) {
  const paid = status === "paid";
  const draft = status === "draft";
  const label = paid ? "PAID" : draft ? "DRAFT" : "UNPAID";
  const pw = label.length * 6.4 + 20, ph = 20;
  const x = rightX - pw;
  doc.fill(x, yy - 6, pw, ph, paid ? [0.16, 0.55, 0.28] : draft ? DRAFT_GRAY : GOLD);
  doc.text(x + 10, yy, 9, label, true, false, paid ? WHITE : INK);
}

function drawModern(inv: PdfInvoice, doc: PdfDoc) {
  /* ---- dark header band (page 1) ---- */
  const bandH = 148;
  doc.fill(0, PAGE_H - bandH, PAGE_W, bandH, INK);
  /* #241: brand lockup — logo mark left of the title, white on the band */
  const logoSize = 40;
  drawLogo(doc, M, PAGE_H - 28, logoSize, WHITE);
  const titleX = M + logoSize + 14;
  doc.text(titleX, PAGE_H - 62, 30, "ZINVOICE", true, false, WHITE);
  doc.fill(titleX, PAGE_H - 74, 72, 3.5, GOLD);
  doc.rtext(RIGHT, PAGE_H - 52, 15, inv.number, true, WHITE);
  statusBadge(doc, RIGHT, PAGE_H - 74, inv.status);
  doc.y = PAGE_H - bandH - 36;

  /* ---- bill-to (left) / from (right) ---- */
  const colsY = doc.y;
  doc.text(M, colsY, 8.5, "B I L L   T O", true, true);
  doc.text(M, colsY - 17, 13, inv.clientName || "-", true);
  /* #627: client address (multi-line) + email under the name. */
  let billY = colsY - 17 - 16;
  const billLines = [
    ...(inv.clientAddress ? inv.clientAddress.split("\n").map(l => l.trim()).filter(Boolean) : []),
    ...(inv.clientEmail ? [inv.clientEmail.trim()] : []),
  ].slice(0, 4);
  for (const line of billLines) { doc.text(M, billY, 10, line, false, true); billY -= 15; }
  let colsBottom = billY - 17;
  const hasFrom = inv.fromName || inv.fromEmail || inv.fromAddress;
  if (hasFrom) {
    let fy = colsY;
    doc.rtext(RIGHT, fy, 8.5, "F R O M", true, true); fy -= 17;
    /* #637: From block mirrors the Bill-to order — name, address lines,
       then email last. */
    if (inv.fromName) { doc.rtext(RIGHT, fy, 12, inv.fromName, true); fy -= 16; }
    if (inv.fromAddress) {
      for (const line of inv.fromAddress.split("\n").slice(0, 3)) {
        if (!line.trim()) continue;
        doc.rtext(RIGHT, fy, 10, line.trim(), false, true); fy -= 15;
      }
    }
    if (inv.fromEmail) { doc.rtext(RIGHT, fy, 10, inv.fromEmail, false, true); fy -= 15; }
    colsBottom = Math.min(colsBottom, fy - 20);
  }
  doc.y = colsBottom;

  /* #615: issued/billing dates sit directly above the table headers —
     below the parties row, not above it.
     #624: no Billing period summary line — the table's per-line Date
     column already states it. */
  let datesStr = `Issued ${fmtDate(inv.issueDate)}`;
  if (inv.dueDate && !inv.hideDue) datesStr += `   |   Due ${fmtDate(inv.dueDate)}`;
  doc.text(M, doc.y, 10, datesStr, false, SOFT);
  doc.y -= 28;

  /* ---- line-item table ---- */
  const C_DATE = M, C_DESC = 150, C_HOURS = 400, C_RATE = 480, C_AMT = RIGHT;
  const RH = 24;
  const tableHead = () => {
    doc.fill(M, doc.y - 8, RIGHT - M, 24, INK);
    doc.text(C_DATE + 10, doc.y, 9, "D A T E", true, false, WHITE);
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
    const desc = it.description.length > 44 ? it.description.slice(0, 41) + "..." : it.description;
    doc.text(C_DATE + 10, doc.y - 2, 10, lineDate(it));
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
  totalRow(inv.status === "paid" ? "TOTAL" : "TOTAL DUE", money(inv.total), true, 14, true);

  /* ---- payment (#243): online payment link + plain-language terms ---- */
  if (inv.payUrl) {
    doc.y -= 8;
    doc.text(M, doc.y, 8.5, "P A Y   O N L I N E", true, true);
    doc.y -= 15;
    doc.text(M, doc.y, 10, inv.payUrl);
    doc.y -= 14;
  }
  if (inv.terms?.trim()) {
    doc.y -= 8;
    doc.text(M, doc.y, 8.5, "P A Y M E N T   T E R M S", true, true);
    doc.y -= 15;
    para(doc, inv.terms.trim(), 10);
    doc.y -= 8;
  }

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
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${M} 40 Td (${escPdf(inv.number)} - Generated by Zimer) Tj ET`);
    const pg = `Page ${i + 1} of ${doc.pages.length}`;
    p.push(`BT 0.45 0.45 0.45 rg /F1 9 Tf ${(RIGHT - numWidth(pg, 9)).toFixed(1)} 40 Td (${escPdf(pg)}) Tj ET`);
  });
}

/** Render an invoice PDF. There is a single template (Modern, #233/#239);
    the stored template value is ignored. */
export function invoicePdf(inv: PdfInvoice): Uint8Array {
  const doc = new PdfDoc();
  drawModern(inv, doc);
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
