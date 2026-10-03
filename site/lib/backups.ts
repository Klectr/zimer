/** #730 part 2: per-customer SQLite backups for hosted mode.
 *
 *  Every tenant database (DATA_DIR/tenants/<user_id>/timekeep.db) is copied
 *  on a schedule to DATA_DIR/backups/<user_id>/timekeep-<utc-timestamp>.db,
 *  and the accounts control plane goes separately to
 *  DATA_DIR/backups/accounts-<utc-timestamp>.db — never inside a tenant's
 *  folder, because accounts.db holds password hashes and session tokens and
 *  must not ship anywhere a customer backup goes.
 *
 *  Bun's sqlite has no `Database#backup` (verified on Bun 1.4), so copies go
 *  through `VACUUM INTO`, which writes a compacted, fully consistent snapshot
 *  of the live database into a new file. VACUUM INTO refuses to overwrite an
 *  existing file, so each destination is unique by timestamp; a timestamp
 *  collision retries with the next second. userId is a number from the
 *  accounts DB primary key, so String(userId) can't smuggle a path
 *  traversal — same reasoning as tenants.ts.
 *
 *  Retention: one backup per UTC day, the newest kept, for RETENTION_DAYS
 *  (7) days; older days are pruned. A backup directory that grows
 *  unboundedly will eventually eat the data volume, which is how a SQLite
 *  app dies.
 */

import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const RETENTION_DAYS = 7;
/** Freshness threshold for /health — matches the hosted-ops.md alert rule. */
export const FRESH_BACKUP_MS = 24 * 3600 * 1000;

export function backupRoot(dataDir: string): string {
  return join(dataDir, "backups");
}

export function tenantBackupDir(dataDir: string, userId: number): string {
  return join(backupRoot(dataDir), String(userId));
}

/** "20261003T120400Z" — sorts lexicographically and embeds the UTC day the
 *  retention logic groups by. */
export function backupTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function dayOf(filename: string): string | null {
  const m = filename.match(/(\d{8})T\d{6}Z\.db$/);
  return m ? m[1] : null;
}

function sqlQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/** Copy srcPath into a new file destPath via VACUUM INTO. Unique-name
 *  collision (VACUUM INTO won't overwrite) advances the timestamp by one
 *  second. Returns destPath. */
function vacuumInto(srcPath: string, destPath: string): string {
  const db = new Database(srcPath, { create: false, readonly: true });
  try {
    let dest = destPath;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        db.run(`VACUUM INTO ${sqlQuote(dest)}`);
        return dest;
      } catch (e) {
        if (attempt === 9 || !/already exists/i.test(String(e))) throw e;
        /* Same-second collision: bump the timestamp and retry. */
        const base = dest.replace(/T(\d{6})Z\.db$/, (_m, t) => {
          const n = Number(t) + 1;
          return `T${String(n).padStart(6, "0")}Z.db`;
        });
        dest = base;
      }
    }
    throw new Error(`vacuumInto: exhausted retries for ${srcPath}`);
  } finally {
    db.close();
  }
}

/** Copy one tenant's database. Returns the backup path, or null when the
 *  tenant has no database yet (nothing to back up — not an error). */
export function backupTenant(dataDir: string, userId: number): string | null {
  const src = join(dataDir, "tenants", String(userId), "timekeep.db");
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(src);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const dir = tenantBackupDir(dataDir, userId);
  mkdirSync(dir, { recursive: true });
  const dest = vacuumInto(src, join(dir, `timekeep-${backupTimestamp()}.db`));
  pruneBackups(dir);
  return dest;
}

/** Back up the accounts control plane. Separate destination on purpose —
 *  accounts.db holds credentials and session tokens and is never copied into
 *  a tenant's backup folder. Returns the backup path, or null in self-host
 *  mode where accounts.db doesn't exist. */
export function backupAccounts(dataDir: string): string | null {
  const src = join(dataDir, "accounts.db");
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(src);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const dir = backupRoot(dataDir);
  mkdirSync(dir, { recursive: true });
  const dest = vacuumInto(src, join(dir, `accounts-${backupTimestamp()}.db`));
  pruneBackups(dir);
  return dest;
}

/** Keep the newest backup per UTC day for the last `keepDays` days; delete
 *  the rest. Files without a parseable timestamp fall back to mtime.
 *  Returns the number of files pruned. */
export function pruneBackups(dir: string, keepDays: number = RETENTION_DAYS): number {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".db"));
  } catch {
    return 0;
  }
  if (names.length === 0) return 0;
  const byDay = new Map<string, string>();
  for (const name of names) {
    let day = dayOf(name);
    if (!day) {
      try {
        day = statSync(join(dir, name)).mtime.toISOString().slice(0, 10).replace(/-/g, "");
      } catch {
        continue;
      }
    }
    const cur = byDay.get(day);
    if (!cur || name > cur) byDay.set(day, name);
  }
  const keep = new Set([...byDay.keys()].sort().reverse().slice(0, keepDays).map((d) => byDay.get(d)!));
  let pruned = 0;
  for (const name of names) {
    if (!keep.has(name)) {
      try {
        unlinkSync(join(dir, name));
        pruned++;
      } catch {
        /* A file that vanished mid-prune isn't a failure. */
      }
    }
  }
  return pruned;
}

/** Back up every tenant found under DATA_DIR/tenants/<id>/ plus the accounts
 *  control plane. Non-numeric tenant directory names are skipped. Never
 *  throws on a per-tenant failure — one broken customer file must not stop
 *  the other backups; failures are returned in `errors`. */
export function backupAll(dataDir: string): {
  tenants: { userId: number; dest: string }[];
  accounts: string | null;
  errors: string[];
} {
  const tenants: { userId: number; dest: string }[] = [];
  const errors: string[] = [];
  let tenantNames: string[] = [];
  try {
    tenantNames = readdirSync(join(dataDir, "tenants"));
  } catch {
    /* No tenants directory yet — still back up accounts. */
  }
  for (const name of tenantNames) {
    if (!/^\d+$/.test(name)) continue;
    const userId = Number(name);
    try {
      const dest = backupTenant(dataDir, userId);
      if (dest) tenants.push({ userId, dest });
    } catch (e) {
      errors.push(`tenant ${userId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let accounts: string | null = null;
  try {
    accounts = backupAccounts(dataDir);
  } catch (e) {
    errors.push(`accounts: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { tenants, accounts, errors };
}

function newestDbMtime(dir: string): number | null {
  let latest: number | null = null;
  try {
    for (const n of readdirSync(dir)) {
      if (!n.endsWith(".db")) continue;
      try {
        const m = statSync(join(dir, n)).mtimeMs;
        if (latest === null || m > latest) latest = m;
      } catch {
        /* skip */
      }
    }
  } catch {
    return null;
  }
  return latest;
}

/** /health freshness snapshot: ISO time of the newest accounts backup (null
 *  when none), and how many tenants have a backup newer than FRESH_BACKUP_MS. */
export function backupFreshness(dataDir: string): {
  accounts: string | null;
  tenants: number;
} {
  const root = backupRoot(dataDir);
  const accountsMtime = newestDbMtime(root);
  let tenants = 0;
  const now = Date.now();
  let tenantNames: string[] = [];
  try {
    tenantNames = readdirSync(join(dataDir, "tenants"));
  } catch {
    tenantNames = [];
  }
  for (const name of tenantNames) {
    if (!/^\d+$/.test(name)) continue;
    const m = newestDbMtime(tenantBackupDir(dataDir, Number(name)));
    if (m !== null && now - m < FRESH_BACKUP_MS) tenants++;
  }
  return {
    accounts: accountsMtime === null ? null : new Date(accountsMtime).toISOString(),
    tenants,
  };
}
