/** #733: per-tenant SQLite isolation for hosted mode.
 *  #745: flat layout — each hosted user gets their own SQLite file at
 *  DATA_DIR/<user_id>.db (no tenants/ nesting, no subdomains), created lazily
 *  on their first authenticated request via the existing schema/migrations
 *  in createDbAt(). Resolved bundles are cached in a Map keyed by user id,
 *  so a tenant's prepared statements are built once per server lifetime.
 *
 *  The accounts control plane (accounts.db) is never touched here — it holds
 *  credentials and sessions only. Customer data lives exclusively in the
 *  per-user files. userId comes from the accounts DB's INTEGER PRIMARY KEY,
 *  so String(userId) can't smuggle a path traversal.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDbAt, type DbBundle } from "../db.ts";

export function tenantDbPath(dataDir: string, userId: number): string {
  return join(dataDir, `${userId}.db`);
}

/** #741: cross-tenant routing for the sessionless surfaces (public invoice
 *  links, the Stripe webhook). Scans DATA_DIR for <user_id>.db files — the
 *  same /^\d+\.db$/ enumeration backups use — opens each read-only, and
 *  returns the user id of the first file whose invoices table matches.
 *  Control-plane purity holds: no routing map in accounts.db, the accounts
 *  DB is never touched here. Tokens and link ids are credentials — never
 *  log them; callers pass them straight through to the query. */
function scanTenantDbs(dataDir: string, sql: string, param: string): number | null {
  let names: string[] = [];
  try {
    names = readdirSync(dataDir);
  } catch {
    return null;
  }
  for (const name of names) {
    const m = name.match(/^(\d+)\.db$/);
    if (!m) continue;
    let db: Database | null = null;
    try {
      db = new Database(join(dataDir, name), { readonly: true });
      if (db.query(sql).get(param)) return Number(m[1]);
    } catch {
      /* Not a timekeep DB, or its schema predates the column — skip. */
    } finally {
      try {
        db?.close();
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** Owning tenant for a public invoice token, or null. */
export function findTenantByPublicToken(dataDir: string, token: string): number | null {
  return scanTenantDbs(
    dataDir,
    "SELECT 1 FROM invoices WHERE public_token = ? LIMIT 1",
    token
  );
}

/** Owning tenant for a Stripe payment-link id, or null. Link ids are
 *  globally unique per Stripe, so the match is unambiguous. */
export function findTenantByPaymentLinkId(
  dataDir: string,
  linkId: string
): number | null {
  return scanTenantDbs(
    dataDir,
    "SELECT 1 FROM invoices WHERE stripe_payment_link_id = ? LIMIT 1",
    linkId
  );
}

export interface TenantStore<T> {
  /** Resolve the tenant app for a user id, creating its SQLite file (and
   *  running schema/migrations) on first use. The built value is cached. */
  get(userId: number): T;
  /** Number of tenants currently cached (diagnostics/tests). */
  size(): number;
}

export function createTenantStore<T>(
  dataDir: string,
  build: (bundle: DbBundle, dbPath: string) => T
): TenantStore<T> {
  const cache = new Map<number, T>();
  return {
    get(userId: number): T {
      let t = cache.get(userId);
      if (!t) {
        const dbPath = tenantDbPath(dataDir, userId);
        /* createDbAt() runs the full schema + idempotent migrations, so a
           brand-new tenant file is a working database immediately. */
        t = build(createDbAt(dbPath), dbPath);
        cache.set(userId, t);
      }
      return t;
    },
    size: () => cache.size,
  };
}
