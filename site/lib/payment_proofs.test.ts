/** Issue #956: proof-of-payment validation + CRUD. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import {
  PROOF_MAX_BYTES,
  countProofs,
  deleteProof,
  getProof,
  insertProof,
  listProofs,
  sanitizeFilename,
  validateProofFile,
} from "./payment_proofs.ts";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 4, 5, 6, 7, 8]);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4, 5, 6, 7]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

describe("validateProofFile", () => {
  test("accepts PNG, JPEG, GIF, WebP, PDF with matching magic bytes", () => {
    expect(validateProofFile(png, "image/png")).toBeNull();
    expect(validateProofFile(jpeg, "image/jpeg")).toBeNull();
    expect(validateProofFile(gif, "image/gif")).toBeNull();
    expect(validateProofFile(webp, "image/webp")).toBeNull();
    expect(validateProofFile(pdf, "application/pdf")).toBeNull();
  });
  test("rejects non-allowlisted MIME types", () => {
    expect(validateProofFile(png, "application/octet-stream")).not.toBeNull();
    expect(validateProofFile(png, "text/html")).not.toBeNull();
    expect(validateProofFile(png, "image/svg+xml")).not.toBeNull();
  });
  test("rejects magic-byte mismatch (client MIME not trusted)", () => {
    // PNG bytes claimed as PDF, and vice versa
    expect(validateProofFile(png, "application/pdf")).not.toBeNull();
    expect(validateProofFile(pdf, "image/png")).not.toBeNull();
    // HTML masquerading as PNG
    const html = new TextEncoder().encode("<html><body>hi</body></html>!");
    expect(validateProofFile(html, "image/png")).not.toBeNull();
  });
  test("rejects empty and oversized files", () => {
    expect(validateProofFile(new Uint8Array(0), "image/png")).not.toBeNull();
    const big = new Uint8Array(PROOF_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    expect(validateProofFile(big, "image/png")).not.toBeNull();
    const ok = new Uint8Array(PROOF_MAX_BYTES);
    ok.set([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateProofFile(ok, "image/png")).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  test("strips path components and unsafe characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\fakepath\\receipt (1).png")).toBe("receipt_1_.png");
    expect(sanitizeFilename("")).toBe("proof");
    expect(sanitizeFilename("...")).toBe("proof");
  });
  test("caps length", () => {
    expect(sanitizeFilename("a".repeat(200) + ".png").length).toBeLessThanOrEqual(120);
  });
});

describe("proof CRUD", () => {
  function setup() {
    const db = createDb(mkdtempSync(join(tmpdir(), "tk-proofs-"))).db;
    db.query("INSERT INTO clients (name, color, rate) VALUES ('Bytebot', '#fb923c', 40)").run();
    const c = db.query("SELECT id FROM clients").get() as { id: number };
    db.query("INSERT INTO invoices (client_id, number, issue_date, status) VALUES (?, 'INV-0001', '2026-10-01', 'paid')").run(c.id);
    const inv = db.query("SELECT id FROM invoices").get() as { id: number };
    return { db, invId: inv.id };
  }
  test("insert → list → get → delete round trip", () => {
    const { db, invId } = setup();
    expect(countProofs(db, invId)).toBe(0);
    const id = insertProof(db, invId, "receipt.png", "image/png", png);
    expect(id).toBeGreaterThan(0);
    expect(countProofs(db, invId)).toBe(1);
    const listed = listProofs(db, invId);
    expect(listed).toHaveLength(1);
    expect(listed[0].filename).toBe("receipt.png");
    expect(listed[0].mime).toBe("image/png");
    expect(listed[0].size).toBe(png.length);
    expect(listed[0]).not.toHaveProperty("data"); // list omits the blob
    const full = getProof(db, invId, id)!;
    expect(full.data).toEqual(png);
    expect(deleteProof(db, invId, id)).toBe(true);
    expect(countProofs(db, invId)).toBe(0);
    expect(deleteProof(db, invId, id)).toBe(false);
  });
  test("proofs are scoped to their invoice", () => {
    const { db, invId } = setup();
    const other = (() => {
      db.query("INSERT INTO invoices (client_id, number, issue_date, status) VALUES (1, 'INV-0002', '2026-10-02', 'paid')").run();
      return (db.query("SELECT id FROM invoices WHERE number = 'INV-0002'").get() as { id: number }).id;
    })();
    const id = insertProof(db, invId, "a.png", "image/png", png);
    expect(getProof(db, other, id)).toBeNull(); // wrong invoice → not found
    expect(deleteProof(db, other, id)).toBe(false);
    expect(listProofs(db, other)).toHaveLength(0);
  });
});
