/** #733: per-tenant SQLite isolation — the tenant store. Tenant files are
 *  created lazily as DATA_DIR/<user_id>.db (#745: flat layout, no nesting),
 *  cached by user id, and fully isolated from each other. */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDbAt, type DbBundle } from "../db.ts";
import { createTenantStore, tenantDbPath } from "./tenants.ts";

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "tk-tenants-"));
  const built: DbBundle[] = [];
  const store = createTenantStore(dataDir, (bundle: DbBundle, dbPath: string) => {
    built.push(bundle);
    return { bundle, dbPath };
  });
  return { dataDir, store, built };
}

describe("tenant store (#733)", () => {
  test("paths are flat DATA_DIR/<user_id>.db (#745)", () => {
    expect(tenantDbPath("/data", 42)).toBe(join("/data", "42.db"));
  });

  test("tenant file is created lazily on first get(), with full schema", () => {
    const { dataDir, store, built } = setup();
    expect(existsSync(join(dataDir, "7.db"))).toBe(false);
    const t = store.get(7);
    expect(existsSync(tenantDbPath(dataDir, 7))).toBe(true);
    expect(t.dbPath).toBe(tenantDbPath(dataDir, 7));
    expect(built.length).toBe(1);
    /* createDb() ran: schema + migrations are present in the fresh file. */
    const tables = t.bundle.db
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    for (const need of ["clients", "projects", "time_entries", "invoices", "invoice_items", "meta"])
      expect(tables.map((r) => r.name)).toContain(need);
    const cols = t.bundle.db.query("PRAGMA table_info(invoices)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("public_token");
  });

  test("repeat gets return the cached build (one build per user)", () => {
    const { store, built } = setup();
    const a = store.get(1);
    const b = store.get(1);
    expect(a).toBe(b);
    expect(built.length).toBe(1);
    expect(store.size()).toBe(1);
  });

  test("different users get different files; writes never cross", () => {
    const { dataDir, store } = setup();
    const a = store.get(1);
    const b = store.get(2);
    expect(a.dbPath).not.toBe(b.dbPath);
    expect(store.size()).toBe(2);
    a.bundle.db.query("INSERT INTO time_entries (description, start_time) VALUES (?, ?)").run(
      "alice work", new Date().toISOString());
    const aRows = a.bundle.db.query("SELECT COUNT(*) AS n FROM time_entries").get() as { n: number };
    const bRows = b.bundle.db.query("SELECT COUNT(*) AS n FROM time_entries").get() as { n: number };
    expect(aRows.n).toBe(1);
    expect(bRows.n).toBe(0);
    /* And it survives a reopen — the file on disk is the source of truth. */
    const reopened = createDbAt(join(dataDir, "1.db"));
    const n = reopened.db.query("SELECT COUNT(*) AS n FROM time_entries").get() as { n: number };
    expect(n.n).toBe(1);
  });
});
