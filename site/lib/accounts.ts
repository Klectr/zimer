/** #732: hosted accounts control plane. Users + sessions live in a separate
 *  accounts.db inside DATA_DIR — customer credentials only. Customer DATA
 *  (entries, invoices, clients) NEVER lands here; per-tenant SQLite files
 *  hold that (#733). Gated behind HOSTED=1; the self-host single-token
 *  path never touches this module. */

import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export const SESSION_COOKIE = "tksession";
export const SESSION_MAX_AGE_SEC = 30 * 24 * 3600; /* 30 days */

/* Dummy argon2id hash: login verifies against this when the email is
   unknown, so response timing doesn't leak which emails are registered. */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$7IkvHxrDcM8uHyCN2lwl/SrjzVTwbjIrZwL/P7wmrPc$rvFgNlgr9rDPwzzbtvB8VEZq4JexKOt+SaO8suf/xW0";

export interface AccountUser {
  id: number;
  email: string;
  subdomain: string | null; /* #734: claimed workspace slug, unique, nullable */
  created_at: string;
}

export function createAccountsDb(dataDir: string) {
  const db = new Database(join(dataDir, "accounts.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  subdomain TEXT, /* #734: claimed workspace slug, UNIQUE, optional */
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);
  /* #734 migration: accounts.db files created by #732 lack the column. */
  try {
    db.exec("ALTER TABLE users ADD COLUMN subdomain TEXT;");
  } catch {
    /* column already present */
  }
  /* SQLite UNIQUE allows multiple NULLs — the optional field stays optional. */
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_subdomain ON users(subdomain);");

  const qUserByEmail = db.query(
    "SELECT id, email, subdomain, created_at FROM users WHERE email = ?"
  );
  const qHashByEmail = db.query("SELECT password_hash FROM users WHERE email = ?");
  const qSession = db.query("SELECT user_id, expires_at FROM sessions WHERE token = ?");
  const qUserById = db.query(
    "SELECT id, email, subdomain, created_at FROM users WHERE id = ?"
  );
  const qUserBySubdomain = db.query(
    "SELECT id, email, subdomain, created_at FROM users WHERE subdomain = ?"
  ); /* #734 */

  const normEmail = (email: string): string => email.trim().toLowerCase();
  const validEmail = (email: string): boolean =>
    email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  /* #734: workspace slug — lowercase letters, digits, dashes, 3–30 chars. */
  const normSubdomain = (s: string): string => s.trim().toLowerCase();
  const validSubdomain = (s: string): boolean => /^[a-z0-9-]{3,30}$/.test(s);

  /** Create a user. Returns { user } or { error }. The plaintext password
   *  is hashed with argon2id and never stored.
   *  #734: subdomain is optional — an empty value skips the claim. */
  async function signup(
    email: string,
    password: string,
    subdomain?: string
  ): Promise<{ user?: AccountUser; error?: string }> {
    const e = normEmail(email);
    if (!validEmail(e)) return { error: "Enter a valid email address." };
    if (password.length < 8)
      return { error: "Password must be at least 8 characters." };
    if (qUserByEmail.get(e)) return { error: "That email is already registered." };
    const slug = normSubdomain(subdomain || "");
    if (slug) {
      if (!validSubdomain(slug))
        return {
          error:
            "Workspace address must be 3 to 30 lowercase letters, numbers, or dashes.",
        };
      if (qUserBySubdomain.get(slug))
        return { error: "That workspace address is already taken." };
    }
    const password_hash = await Bun.password.hash(password);
    const user = db
      .query(
        "INSERT INTO users (email, password_hash, subdomain) VALUES (?, ?, ?) RETURNING id, email, subdomain, created_at"
      )
      .get(e, password_hash, slug || null) as AccountUser;
    return { user };
  }

  /** Verify credentials and mint a session token. Generic error either way —
   *  callers can't distinguish "unknown email" from "wrong password". */
  async function login(
    email: string,
    password: string
  ): Promise<{ token?: string; error?: string }> {
    const e = normEmail(email);
    const row = qHashByEmail.get(e) as { password_hash: string } | null;
    const ok = await Bun.password.verify(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) return { error: "Wrong email or password." };
    const user = qUserByEmail.get(e) as AccountUser;
    return { token: createSession(user.id) };
  }

  /** Mint a session token for a user id. */
  function createSession(userId: number): string {
    const token = randomBytes(32).toString("hex");
    const expires_at = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000).toISOString();
    db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
      token,
      userId,
      expires_at
    );
    return token;
  }

  /** Look up the user for a session token. Expired sessions are dropped. */
  function sessionUser(token: string): AccountUser | null {
    const s = qSession.get(token) as { user_id: number; expires_at: string } | null;
    if (!s) return null;
    if (s.expires_at <= new Date().toISOString()) {
      db.query("DELETE FROM sessions WHERE token = ?").run(token);
      return null;
    }
    return (qUserById.get(s.user_id) as AccountUser | null) ?? null;
  }

  /** The account owning a workspace slug, or null. #734: powers subdomain
   *  tenant resolution. */
  function userBySubdomain(slug: string): AccountUser | null {
    const s = normSubdomain(slug);
    if (!s) return null;
    return (qUserBySubdomain.get(s) as AccountUser | null) ?? null;
  }

  function destroySession(token: string): void {
    db.query("DELETE FROM sessions WHERE token = ?").run(token);
  }

  /** Extract the session token from a request's cookies. */
  function sessionTokenFromRequest(req: Request): string | null {
    const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)tksession=([^;]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }

  /** The session user for a request, or null. */
  function sessionUserFromRequest(req: Request): AccountUser | null {
    const t = sessionTokenFromRequest(req);
    return t ? sessionUser(t) : null;
  }

  const sessionCookie = (token: string): string =>
    `tksession=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}`;
  const clearSessionCookie =
    "tksession=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";

  return {
    db,
    signup,
    login,
    createSession,
    sessionUser,
    userBySubdomain, /* #734 */
    destroySession,
    sessionTokenFromRequest,
    sessionUserFromRequest,
    sessionCookie,
    clearSessionCookie,
  };
}

export type AccountsDb = ReturnType<typeof createAccountsDb>;
