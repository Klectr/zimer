/** #732: hosted accounts control plane. Users + sessions live in a separate
 *  accounts.db inside DATA_DIR — customer credentials only. Customer DATA
 *  (entries, invoices, clients) NEVER lands here; per-tenant SQLite files
 *  hold that (#733). Gated behind HOSTED=1; the self-host single-token
 *  path never touches this module. */

import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { secureCookieAttr } from "./http.ts";

export const SESSION_COOKIE = "tksession";
export const SESSION_MAX_AGE_SEC = 30 * 24 * 3600; /* 30 days */

/* Dummy argon2id hash: login verifies against this when the email is
   unknown, so response timing doesn't leak which emails are registered. */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$7IkvHxrDcM8uHyCN2lwl/SrjzVTwbjIrZwL/P7wmrPc$rvFgNlgr9rDPwzzbtvB8VEZq4JexKOt+SaO8suf/xW0";

export interface AccountUser {
  id: number;
  email: string;
  created_at: string;
}

export function createAccountsDb(dataDir: string) {
  const db = new Database(join(dataDir, "accounts.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA cache_size = -8000;");
  db.exec("PRAGMA temp_store = MEMORY;");
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

  /* #940: soft-delete column for DBs created before it existed. */
  const userCols = db.query("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some(c => c.name === "deleted_at")) {
    db.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT");
  }

  /* #986: session tokens are stored as SHA-256 hashes, never verbatim —
     a leaked accounts.db copy must not be a session-takeover kit. One-time
     migration for sessions written by older versions, guarded by
     user_version so later boots skip it. */
  const hashSessionToken = (t: string): string =>
    createHash("sha256").update(t).digest("hex");
  const uv = db.query("PRAGMA user_version").get() as { user_version: number };
  if (uv.user_version < 1) {
    db.transaction(() => {
      const rows = db.query("SELECT token FROM sessions").all() as { token: string }[];
      const upd = db.query("UPDATE sessions SET token = ? WHERE token = ?");
      for (const r of rows) upd.run(hashSessionToken(r.token), r.token);
      db.exec("PRAGMA user_version = 1");
    })();
  }

  const qUserByEmail = db.query(
    "SELECT id, email, created_at FROM users WHERE email = ?"
  );
  /* #940: login and session validation ignore soft-deleted users. The
     unfiltered qUserByEmail stays for signup, so a deleted email can't be
     re-registered. */
  const qLiveUserByEmail = db.query(
    "SELECT id, email, created_at FROM users WHERE email = ? AND deleted_at IS NULL"
  );
  const qHashByEmail = db.query("SELECT password_hash FROM users WHERE email = ? AND deleted_at IS NULL");
  const qSession = db.query("SELECT user_id, expires_at FROM sessions WHERE token = ?");
  const qUserById = db.query("SELECT id, email, created_at FROM users WHERE id = ? AND deleted_at IS NULL");

  const normEmail = (email: string): string => email.trim().toLowerCase();
  const validEmail = (email: string): boolean =>
    email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

  /** Create a user. Returns { user } or { error }. The plaintext password
   *  is hashed with argon2id and never stored. */
  async function signup(
    email: string,
    password: string
  ): Promise<{ user?: AccountUser; error?: string }> {
    const e = normEmail(email);
    if (!validEmail(e)) return { error: "Enter a valid email address." };
    if (password.length < 8)
      return { error: "Password must be at least 8 characters." };
    /* #913: never confirm registration. The existence check alone would
       enumerate accounts by message AND by timing (fresh emails pay the
       argon2 cost, registered ones used to answer instantly) — so hash on
       both paths and give the duplicate case the generic failure. */
    const exists = !!qUserByEmail.get(e);
    const password_hash = await Bun.password.hash(password);
    if (exists) return { error: "Couldn't create your account. If you already have one, log in instead." };
    try {
      const user = db
        .query(
          "INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id, email, created_at"
        )
        .get(e, password_hash) as AccountUser;
      return { user };
    } catch {
      /* #913: a concurrent signup for the same fresh email passed the
         check above too — the UNIQUE constraint is the real guard, and
         its loser gets the same generic failure, never a 500. */
      return { error: "Couldn't create your account. If you already have one, log in instead." };
    }
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
    const user = qLiveUserByEmail.get(e) as AccountUser;
    return { token: createSession(user.id) };
  }

  /** Mint a session token for a user id. The raw token goes to the cookie;
   *  #986: only its SHA-256 hash is stored. */
  function createSession(userId: number): string {
    const token = randomBytes(32).toString("hex");
    const expires_at = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000).toISOString();
    db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
      hashSessionToken(token),
      userId,
      expires_at
    );
    return token;
  }

  /** Look up the user for a session token. Expired sessions are dropped. */
  function sessionUser(token: string): AccountUser | null {
    const h = hashSessionToken(token);
    const s = qSession.get(h) as { user_id: number; expires_at: string } | null;
    if (!s) return null;
    if (s.expires_at <= new Date().toISOString()) {
      db.query("DELETE FROM sessions WHERE token = ?").run(h);
      return null;
    }
    return (qUserById.get(s.user_id) as AccountUser | null) ?? null;
  }

  function destroySession(token: string): void {
    db.query("DELETE FROM sessions WHERE token = ?").run(hashSessionToken(token));
  }

  /** #987/#1421: change a live user's password. Verifies the current
   *  password, applies the signup length rule to the new one, revokes
   *  every session, and mints a fresh one returned to the caller — so a
   *  copied copy of the old token cannot survive the change. */
  async function changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string
  ): Promise<{ token?: string; error?: string }> {
    if (newPassword.length < 8)
      return { error: "New password must be at least 8 characters." };
    if (newPassword.length > 4096)
      return { error: "New password is too long." };
    if (newPassword === currentPassword)
      return { error: "New password must be different from your current password." };
    const row = db
      .query("SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL")
      .get(userId) as { password_hash: string } | null;
    if (!row) return { error: "Account not found." };
    /* An over-long candidate can never match a real password; reject it
       without paying the argon2 verify on megabytes of input. */
    if (currentPassword.length > 4096)
      return { error: "Current password is wrong." };
    const ok = await Bun.password.verify(currentPassword, row.password_hash);
    if (!ok) return { error: "Current password is wrong." };
    const password_hash = await Bun.password.hash(newPassword);
    const token = randomBytes(32).toString("hex");
    const expires_at = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000).toISOString();
    const stale = new Error("stale password change");
    try {
      db.transaction(() => {
        const upd = db.query("UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL AND password_hash = ?")
          .run(password_hash, userId, row.password_hash);
        if (upd.changes !== 1) throw stale;
        db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
        db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
          hashSessionToken(token),
          userId,
          expires_at
        );
      })();
    } catch (e) {
      if (e === stale) return { error: "Current password is wrong." };
      throw e;
    }
    return { token };
  }

  /** Extract the session token from a request's cookies. */
  function sessionTokenFromRequest(req: Request): string | null {
    const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
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

  /* #911: Secure goes on the cookie when the request arrived over HTTPS
     (hosted site behind the proxy). Omitted on plain-HTTP origins so
     local-dev and Tailscale logins keep working. */
  const sessionCookie = (req: Request, token: string): string =>
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secureCookieAttr(req)}`;
  const clearSessionCookie = (req: Request): string =>
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookieAttr(req)}`;

  return {
    db,
    signup,
    login,
    createSession,
    sessionUser,
    destroySession,
    changePassword,
    sessionTokenFromRequest,
    sessionUserFromRequest,
    sessionCookie,
    clearSessionCookie,
  };
}

export type AccountsDb = ReturnType<typeof createAccountsDb>;
