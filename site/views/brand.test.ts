/** #753: Zimer visual identity — mascot placements.
 *  The Klectr alien, rebadged K→Z: landing hero, invoices empty state,
 *  and the timer "New here?" demo banner. Subtle by design — one image
 *  per surface, never competing with a CTA. */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { createDb } from "../db.ts";
import { demoBanner } from "../lib/demo.ts";
import { createLandingViews } from "./landing.ts";
import { createInvoiceViews } from "./invoices.ts";

const stubQuery = () => ({
  get: (..._a: unknown[]) => ({ n: 0 }),
  all: (..._a: unknown[]) => [],
  run: (..._a: unknown[]) => {},
});
const stubDb = { query: (_sql: string) => stubQuery() } as unknown as Database;

function invoiceViews() {
  return createInvoiceViews({
    db: stubDb,
    qInvoices: { all: () => [] } as unknown as Statement,
    layout: (_t: string, b: string) => b,
    clientOptions: () => "",
    getPublicToken: () => null,
    stripeConfigured: () => false,
    nextInvoiceNumber: () => "INV-0001",
    invoiceTotals: (items: any[], _taxRate: number) => ({
      subtotal: 0, tax: 0,
      total: items.reduce((a: number, it: any) => a + Number(it.amount || 0), 0),
    }),
    statusPill: (s: string) => `<span class="pill">${s}</span>`,
    isOverdue: () => false,
    unbilledByClient: () => [],
  });
}

describe("#753: mascot placements", () => {
  test("landing hero shows the mascot, OG tags, and PNG favicon", () => {
    const { landingPage } = createLandingViews();
    const html = landingPage("https://example.com"); /* #865 */
    expect(html).toContain('class="landing-mascot"');
    expect(html).toContain('src="/static/mascot.png"');
    expect(html).toContain('property="og:image" content="https://example.com/static/og-image-v2.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('href="/static/favicon-32.png"');
    expect(html).toContain('rel="apple-touch-icon" href="/static/alien-180.png"');
    expect(html).not.toContain("logo.svg");
  });

  test("invoices empty state shows the stopwatch mascot, not the receipt icon", () => {
    const html = invoiceViews().invoicesPage(null, "/invoices");
    expect(html).toContain('class="empty-mascot"');
    expect(html).toContain('src="/static/mascot-empty.png"');
    expect(html).toContain("No zinvoices yet");
  });

  test("timer first-run demo banner shows the mascot", () => {
    const db = createDb(mkdtempSync(join(tmpdir(), "tk-brand-"))).db;
    const html = demoBanner(db);
    expect(html).toContain("New here?");
    expect(html).toContain('class="demo-mascot"');
    expect(html).toContain('src="/static/mascot.png"');
  });
});

describe("#843: pumpkin PNG favicon", () => {
  test("favicon-32.png accent matches the pumpkin primary #fb923c", () => {
    const data = readFileSync(new URL("../static/favicon-32.png", import.meta.url));
    // Minimal PNG parse with pure stdlib: IHDR + concatenated IDAT, 8-bit RGB.
    let pos = 8;
    let idat = Buffer.alloc(0);
    let w = 0, h = 0;
    while (pos < data.length) {
      const len = data.readUInt32BE(pos);
      const type = data.toString("ascii", pos + 4, pos + 8);
      const chunk = data.subarray(pos + 8, pos + 8 + len);
      if (type === "IHDR") {
        w = chunk.readUInt32BE(0);
        h = chunk.readUInt32BE(4);
        if (chunk[8] !== 8 || chunk[9] !== 2) throw new Error("unexpected favicon-32.png format");
      } else if (type === "IDAT") {
        idat = Buffer.concat([idat, chunk]);
      }
      pos += 12 + len;
    }
    expect(w).toBe(32);
    expect(h).toBe(32);
    const raw = inflateSync(idat);
    const stride = w * 3;
    const counts = new Map<string, number>();
    let p = 0;
    const prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[p++];
      const line = Buffer.from(raw.subarray(p, p + stride));
      p += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? line[i - 3] : 0;
        if (f === 1) line[i] = (line[i] + a) & 255;
        else if (f === 2) line[i] = (line[i] + prev[i]) & 255;
        else if (f === 3) line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255;
        else if (f === 4) {
          const b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
          const pr = a + b - c;
          const pa = Math.abs(pr - a), pb = Math.abs(pr - b), pc = Math.abs(pr - c);
          line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
      }
      prev.set(line);
      for (let x = 0; x < w; x++) {
        const r = line[x * 3], g = line[x * 3 + 1], b = line[x * 3 + 2];
        // Skip the dark #1f2125 background; count accent pixels.
        if (Math.abs(r - 0x1f) + Math.abs(g - 0x21) + Math.abs(b - 0x25) <= 90) continue;
        const k = `${r},${g},${b}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    expect(counts.size).toBeGreaterThan(0);
    let best = "", bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
    const [r, g, b] = best.split(",").map(Number);
    const dist = Math.abs(r - 0xfb) + Math.abs(g - 0x92) + Math.abs(b - 0x3c);
    // Pumpkin #fb923c scores 0 here; legacy gold #f2c14e scores 74,
    // the old green mascot scores 261 — both fail loudly.
    expect(dist).toBeLessThanOrEqual(32);
  });
});
