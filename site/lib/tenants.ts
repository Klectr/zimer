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

import { join } from "node:path";
import { createDbAt, type DbBundle } from "../db.ts";

export function tenantDbPath(dataDir: string, userId: number): string {
  return join(dataDir, `${userId}.db`);
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
