/** #732: hosted accounts — signup, login, and session behavior. */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountsDb, SESSION_COOKIE } from "./accounts.ts";

function accountsDb() {
  return createAccountsDb(mkdtempSync(join(tmpdir(), "tk-acct-")));
}

describe("hosted accounts (#732)", () => {
  test("signup stores an argon2 hash, never the plaintext password", async () => {
    const a = accountsDb();
    const { user, error } = await a.signup("Ada@example.com", "correct-horse-8");
    expect(error).toBeUndefined();
    /* email is normalized */
    expect(user!.email).toBe("ada@example.com");
    const row = a.db
      .query("SELECT password_hash FROM users WHERE email = ?")
      .get("ada@example.com") as { password_hash: string };
    expect(row.password_hash.startsWith("$argon2")).toBe(true);
    expect(row.password_hash).not.toContain("correct-horse-8");
  });

  test("duplicate email is rejected with a generic error (#913)", async () => {
    const a = accountsDb();
    await a.signup("ada@example.com", "correct-horse-8");
    const r = await a.signup("ADA@example.com", "another-pass-9");
    /* #913: must not reveal that the email is registered — the page already
       offers "Log in instead", so the message stays generic. */
    expect(r.error).toBe("Couldn't create your account. If you already have one, log in instead.");
    expect(r.user).toBeUndefined();
  });

  test("#986: sessions are stored as SHA-256 hashes, never raw tokens", async () => {
    const a = accountsDb();
    await a.signup("ada@example.com", "correct-horse-8");
    const { token } = await a.login("ada@example.com", "correct-horse-8");
    const row = a.db.query("SELECT token FROM sessions").get() as { token: string };
    expect(row.token).not.toBe(token);
    expect(row.token).toBe(createHash("sha256").update(token!).digest("hex"));
    expect(a.sessionUser(token!)!.email).toBe("ada@example.com");
    a.destroySession(token!);
    expect(a.sessionUser(token!)).toBeNull();
  });

  test("#986: pre-migration raw-token sessions are hashed in place and keep working", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-acct-legacy-"));
    const raw = new Database(join(dir, "accounts.db"), { create: true });
    raw.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), deleted_at TEXT);
CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX idx_sessions_user ON sessions(user_id);`);
    raw.query("INSERT INTO users (email, password_hash) VALUES ('ada@example.com', 'x')").run();
    const legacyToken = "a".repeat(64);
    raw.query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, 1, '2999-01-01T00:00:00.000Z')").run(legacyToken);
    raw.close();
    const a = createAccountsDb(dir);
    expect(a.sessionUser(legacyToken)!.email).toBe("ada@example.com");
    const row = a.db.query("SELECT token FROM sessions").get() as { token: string };
    expect(row.token).toBe(createHash("sha256").update(legacyToken).digest("hex"));
  });

  test("#913: concurrent duplicate signups \u2014 one wins, the loser gets the generic error (no throw)", async () => {
    const a = accountsDb();
    const [r1, r2] = await Promise.all([
      a.signup("race@example.com", "correct-horse-8"),
      a.signup("race@example.com", "correct-horse-8"),
    ]);
    const outcomes = [r1, r2];
    expect(outcomes.filter((r) => r.user)).toHaveLength(1);
    const loser = outcomes.find((r) => !r.user)!;
    expect(loser.error).toBe("Couldn't create your account. If you already have one, log in instead.");
  });

  test("bad email and short password are rejected", async () => {
    const a = accountsDb();
    expect((await a.signup("not-an-email", "correct-horse-8")).error).toBe(
      "Enter a valid email address."
    );
    expect((await a.signup("ada@example.com", "short")).error).toBe(
      "Password must be at least 8 characters."
    );
  });

  test("login mints a session; wrong password fails with a generic error", async () => {
    const a = accountsDb();
    await a.signup("ada@example.com", "correct-horse-8");
    const ok = await a.login("ada@example.com", "correct-horse-8");
    expect(ok.error).toBeUndefined();
    expect(ok.token!.length).toBe(64);
    const bad = await a.login("ada@example.com", "wrong-password-1");
    expect(bad.error).toBe("Wrong email or password.");
    expect(bad.token).toBeUndefined();
    const unknown = await a.login("nobody@example.com", "wrong-password-1");
    expect(unknown.error).toBe("Wrong email or password.");
  });

  test("session lookup returns the user; logout kills the session", async () => {
    const a = accountsDb();
    const { user } = await a.signup("ada@example.com", "correct-horse-8");
    const token = a.createSession(user!.id);
    const found = a.sessionUser(token);
    expect(found!.email).toBe("ada@example.com");
    a.destroySession(token);
    expect(a.sessionUser(token)).toBeNull();
  });

  test("expired sessions are dropped on lookup", async () => {
    const a = accountsDb();
    const { user } = await a.signup("ada@example.com", "correct-horse-8");
    const token = "expired-token";
    /* #986: stored form is the token's hash. */
    const stored = createHash("sha256").update(token).digest("hex");
    a.db
      .query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(stored, user!.id, "2000-01-01T00:00:00.000Z");
    expect(a.sessionUser(token)).toBeNull();
    /* and the row is cleaned up */
    const left = a.db
      .query("SELECT token FROM sessions WHERE token = ?")
      .get(stored);
    expect(left).toBeNull();
  });

  test("sessionUserFromRequest parses the cookie", async () => {
    const a = accountsDb();
    const { user } = await a.signup("ada@example.com", "correct-horse-8");
    const token = a.createSession(user!.id);
    const req = new Request("http://x/", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(a.sessionUserFromRequest(req)!.email).toBe("ada@example.com");
    const anon = new Request("http://x/");
    expect(a.sessionUserFromRequest(anon)).toBeNull();
  });

  test("session cookie is HttpOnly with a 30-day max age", () => {
    const a = accountsDb();
    const c = a.sessionCookie(new Request("http://x/"), "abc123");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Path=/");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=2592000");
  });

  test("#911: session cookie is Secure on HTTPS, not on plain HTTP", () => {
    const a = accountsDb();
    const httpReq = new Request("http://x/");
    expect(a.sessionCookie(httpReq, "abc123")).not.toContain("Secure");
    expect(a.clearSessionCookie(httpReq)).not.toContain("Secure");
    const httpsReq = new Request("http://x/", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(a.sessionCookie(httpsReq, "abc123")).toContain("; Secure");
    expect(a.clearSessionCookie(httpsReq)).toContain("; Secure");
  });

  test("#940: soft-deleted users cannot log in", async () => {
    const a = accountsDb();
    const { user } = await a.signup("gone@example.com", "correct-horse-8");
    /* Simulate zimer-admin soft-delete. */
    a.db.query("UPDATE users SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(user!.id);
    const { token, error } = await a.login("gone@example.com", "correct-horse-8");
    expect(token).toBeUndefined();
    expect(error).toBe("Wrong email or password.");
  });

  test("#940: soft-deleted users fail session validation", async () => {
    const a = accountsDb();
    const { user } = await a.signup("sess@example.com", "correct-horse-8");
    const { token } = await a.login("sess@example.com", "correct-horse-8");
    expect(a.sessionUser(token!)).not.toBeNull();
    a.db.query("UPDATE users SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(user!.id);
    expect(a.sessionUser(token!)).toBeNull();
  });

  test("#940: deleted emails cannot be re-registered", async () => {
    const a = accountsDb();
    const { user } = await a.signup("taken@example.com", "correct-horse-8");
    a.db.query("UPDATE users SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(user!.id);
    const { error } = await a.signup("taken@example.com", "another-pass-9");
    expect(error).toBe("Couldn't create your account. If you already have one, log in instead.");
  });
});
