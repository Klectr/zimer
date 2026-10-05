/** #730 part 2: per-customer backups. All work happens in temp DATA_DIRs. */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  backupAccounts,
  backupAll,
  backupFreshness,
  backupTenant,
  pruneBackups,
  tenantBackupDir,
  backupRoot,
  backupTimestamp,
  RETENTION_DAYS,
} from "./backups.ts";
import { tenantDbPath } from "./tenants.ts"; /* #745 */

function tmpDataDir() {
  return mkdtempSync(join(tmpdir(), "tk-backups-"));
}

/** A real tenant db (WAL mode, some rows) like createDb() produces. */
function makeTenantDb(dataDir: string, userId: number, rows: number): string {
  const path = tenantDbPath(dataDir, userId); /* #745: flat DATA_DIR/<user_id>.db */
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("CREATE TABLE time_entries (id INTEGER PRIMARY KEY, description TEXT)");
  for (let i = 0; i < rows; i++) db.run("INSERT INTO time_entries (description) VALUES (?)", [`e${i}`]);
  db.close();
  return path;
}

function makeAccountsDb(dataDir: string): string {
  const path = join(dataDir, "accounts.db");
  const db = new Database(path, { create: true });
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)");
  db.run("INSERT INTO users (email) VALUES ('a@example.com')");
  db.close();
  return path;
}

describe("backups (#730 part 2)", () => {
  test("backup creates a restorable file with identical rows", () => {
    const dataDir = tmpDataDir();
    makeTenantDb(dataDir, 3, 5);
    const dest = backupTenant(dataDir, 3);
    expect(dest).not.toBeNull();
    expect(existsSync(dest!)).toBe(true);
    expect(dest!.startsWith(tenantBackupDir(dataDir, 3))).toBe(true);
    expect(dest!.endsWith(".db")).toBe(true);
    /* #807: on-disk snapshots use the zimer- prefix, matching the download name */
    expect(basename(dest!)).toMatch(/^zimer-\d{8}T\d{6}Z\.db$/);
    const db = new Database(dest!, { readonly: true });
    const { c } = db.query("SELECT COUNT(*) c FROM time_entries").get() as { c: number };
    expect(c).toBe(5);
    expect(db.query("SELECT description FROM time_entries ORDER BY id").all()).toEqual([
      { description: "e0" },
      { description: "e1" },
      { description: "e2" },
      { description: "e3" },
      { description: "e4" },
    ]);
    db.close();
  });

  test("missing tenant db returns null instead of throwing", () => {
    const dataDir = tmpDataDir();
    expect(backupTenant(dataDir, 999)).toBeNull();
    expect(backupTenant(dataDir, 7)).toBeNull(); /* no db file at all */
    expect(existsSync(tenantBackupDir(dataDir, 7))).toBe(false); /* no dir created */
  });

  test("accounts.db is backed up separately, never into a tenant folder", () => {
    const dataDir = tmpDataDir();
    makeAccountsDb(dataDir);
    makeTenantDb(dataDir, 3, 1);
    const dest = backupAccounts(dataDir);
    expect(dest).not.toBeNull();
    expect(dest!).toMatch(/backups[/\\]accounts-[^/\\]+\.db$/);
    expect(dest!).not.toContain(join("backups", "3"));
    const db = new Database(dest!, { readonly: true });
    const { email } = db.query("SELECT email FROM users").get() as { email: string };
    expect(email).toBe("a@example.com");
    db.close();
    /* self-host: no accounts.db → null */
    expect(backupAccounts(tmpDataDir())).toBeNull();
  });

  test("retention keeps the newest file per day for 7 days", () => {
    const dataDir = tmpDataDir();
    const dir = tenantBackupDir(dataDir, 3);
    mkdirSync(dir, { recursive: true });
    for (let d = 1; d <= 10; d++) {
      const day = `202601${String(d).padStart(2, "0")}`;
      writeFileSync(join(dir, `zimer-${day}T060000Z.db`), "x");
      writeFileSync(join(dir, `zimer-${day}T180000Z.db`), "x"); /* two per day */
    }
    const pruned = pruneBackups(dir);
    expect(pruned).toBe(6 * 2 + 1); /* 3 oldest days gone (2 files each) + 1 extra of day 4 */
    const kept = readdirSync(dir).sort();
    expect(kept.length).toBe(7);
    /* newest file of each kept day survives */
    expect(kept).toContain("zimer-20260110T180000Z.db");
    expect(kept).not.toContain("zimer-20260101T180000Z.db");
    expect(kept).not.toContain("zimer-20260104T060000Z.db");
  });

  test("RETENTION_DAYS is 7", () => {
    expect(RETENTION_DAYS).toBe(7);
  });

  test("backupAll covers every tenant plus accounts, tolerating a missing dir", () => {
    const dataDir = tmpDataDir();
    makeTenantDb(dataDir, 3, 2);
    makeTenantDb(dataDir, 4, 1);
    makeAccountsDb(dataDir);
    const { tenants, accounts, errors } = backupAll(dataDir);
    expect(errors).toEqual([]);
    expect(accounts).not.toBeNull();
    expect(tenants.map((t) => t.userId).sort()).toEqual([3, 4]);
    for (const t of tenants) expect(existsSync(t.dest)).toBe(true);
    /* empty data dir: no tenants, no accounts, no errors */
    const r2 = backupAll(tmpDataDir());
    expect(r2.tenants).toEqual([]);
    expect(r2.accounts).toBeNull();
    expect(r2.errors).toEqual([]);
  });

  test("backupFreshness reports accounts time and fresh tenant count", () => {
    const dataDir = tmpDataDir();
    makeTenantDb(dataDir, 3, 1);
    makeTenantDb(dataDir, 4, 1);
    makeAccountsDb(dataDir);
    expect(backupFreshness(dataDir)).toEqual({ accounts: null, tenants: 0 });
    backupAll(dataDir);
    const f = backupFreshness(dataDir);
    expect(f.accounts).not.toBeNull();
    expect(new Date(f.accounts!).getTime()).toBeLessThanOrEqual(Date.now());
    expect(f.tenants).toBe(2);
    /* backup root untouched by tenant files */
    expect(readdirSync(backupRoot(dataDir)).filter((n) => n.endsWith(".db")).length).toBe(1);
  });

  test("backupTimestamp is UTC, lexicographically sortable, valid in filenames", () => {
    const ts = backupTimestamp(new Date("2026-10-03T12:34:56.789Z"));
    expect(ts).toBe("20261003T123456Z");
    expect(/^[0-9]{8}T[0-9]{6}Z$/.test(ts)).toBe(true);
  });
});
