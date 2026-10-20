/** Issue #956: proof-of-payment attachments backing an invoice's paid status.
 *  Files are stored as BLOBs in the tenant DB (like pdf_snapshot) so tenant
 *  isolation and backups come for free. All validation here is server-side —
 *  the client-declared MIME type is never trusted: magic bytes decide. */

import type { Database } from "bun:sqlite";

/* Allowed types: screenshots (png/jpeg/gif/webp) + PDF exports. */
export const PROOF_MIME_ALLOWLIST = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

/* 10 MiB — screenshots and PDF exports fit comfortably; blocks abuse. */
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;

/* #985: per-invoice count cap — proofs are DB BLOBs on a shared disk, so an
   unbounded count lets one tenant fill the volume for everyone. */
export const PROOF_MAX_PER_INVOICE = 10;

export interface PaymentProof {
  id: number;
  invoice_id: number;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
}

/* Magic-byte signatures per allowed type. WebP: RIFF....WEBP. */
function magicOk(bytes: Uint8Array, mime: string): boolean {
  if (bytes.length < 12) return false;
  switch (mime) {
    case "image/png":
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
    case "image/webp":
      return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    case "application/pdf":
      return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    default:
      return false;
  }
}

/** Returns an error message when the file is rejected, null when accepted. */
export function validateProofFile(bytes: Uint8Array, mime: string): string | null {
  if (!PROOF_MIME_ALLOWLIST.has(mime)) {
    return "Only PNG, JPEG, GIF, WebP images and PDF files are accepted.";
  }
  if (bytes.length === 0) return "The file is empty.";
  if (bytes.length > PROOF_MAX_BYTES) {
    return `The file is too large (max ${PROOF_MAX_BYTES / 1024 / 1024} MB).`;
  }
  if (!magicOk(bytes, mime)) {
    return "The file's contents don't match its type.";
  }
  return null;
}

/** Strip path components and unsafe characters; cap length. Never trust the client filename. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() || "proof";
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  const trimmed = clean.slice(0, 120) || "proof";
  return trimmed;
}

export function insertProof(db: Database, invoiceId: number, filename: string, mime: string, data: Uint8Array): number {
  const r = db.query(
    "INSERT INTO invoice_payment_proofs (invoice_id, filename, mime, size, data) VALUES (?, ?, ?, ?, ?)"
  ).run(invoiceId, filename, mime, data.length, data);
  return Number(r.lastInsertRowid);
}

export function listProofs(db: Database, invoiceId: number): PaymentProof[] {
  return db.query(
    "SELECT id, invoice_id, filename, mime, size, created_at FROM invoice_payment_proofs WHERE invoice_id = ? ORDER BY id"
  ).all(invoiceId) as PaymentProof[];
}

export function getProof(db: Database, invoiceId: number, proofId: number): (PaymentProof & { data: Uint8Array }) | null {
  return (db.query(
    "SELECT id, invoice_id, filename, mime, size, created_at, data FROM invoice_payment_proofs WHERE id = ? AND invoice_id = ?"
  ).get(proofId, invoiceId) as (PaymentProof & { data: Uint8Array }) | null) ?? null;
}

export function deleteProof(db: Database, invoiceId: number, proofId: number): boolean {
  const r = db.query("DELETE FROM invoice_payment_proofs WHERE id = ? AND invoice_id = ?").run(proofId, invoiceId);
  return r.changes > 0;
}

export function countProofs(db: Database, invoiceId: number): number {
  const r = db.query("SELECT COUNT(*) AS n FROM invoice_payment_proofs WHERE invoice_id = ?").get(invoiceId) as { n: number };
  return r.n;
}
