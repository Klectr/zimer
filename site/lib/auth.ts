/** Token auth: minting/loading the bearer token, constant-time comparison,
 *  and the API (Bearer header) / page (cookie) auth checks.
 *  The token value is owned by the caller and passed in explicitly. */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function getToken(dataDir: string): string {
  if (process.env.TIMEKEEP_TOKEN) return process.env.TIMEKEEP_TOKEN;
  const p = join(dataDir, ".token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const t = randomBytes(32).toString("hex");
  writeFileSync(p, t, { mode: 0o600 });
  console.log(`\n  Generated API token (the extension + login page need it):\n\n    ${t}\n`);
  return t;
}

export function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function authedApi(req: Request, token: string): boolean {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") && tokensEqual(h.slice(7).trim(), token);
}

export function authedPage(req: Request, token: string): boolean {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)tk=([^;]+)/);
  if (!m) return false;
  try { return tokensEqual(decodeURIComponent(m[1]), token); } catch { return false; }
}
