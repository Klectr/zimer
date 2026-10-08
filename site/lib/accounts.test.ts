/** #732: hosted accounts — signup, login, and session behavior. */
import { describe, expect, test } from "bun:test";
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

  test("duplicate email is rejected", async () => {
    const a = accountsDb();
    await a.signup("ada@example.com", "correct-horse-8");
    const r = await a.signup("ADA@example.com", "another-pass-9");
    expect(r.error).toBe("That email is already registered.");
    expect(r.user).toBeUndefined();
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
    a.db
      .query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(token, user!.id, "2000-01-01T00:00:00.000Z");
    expect(a.sessionUser(token)).toBeNull();
    /* and the row is cleaned up */
    const left = a.db
      .query("SELECT token FROM sessions WHERE token = ?")
      .get(token);
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
});
