/** #732: hosted accounts control plane. Users + sessions live in a separate
 *  accounts.db inside DATA_DIR — customer credentials only. Customer DATA
 *  (entries, invoices, clients) NEVER lands here; per-tenant SQLite files
 *  hold that (#733). Gated behind HOSTED=1; the self-host single-token
 *  path never touches this module. */

import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
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

  /* #911: Secure goes on the cookie when the request arrived over HTTPS
     (hosted site behind the proxy). Omitted on plain-HTTP origins so
     local-dev and Tailscale logins keep working. */
  const sessionCookie = (req: Request, token: string): string =>
    `tksession=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secureCookieAttr(req)}`;
  const clearSessionCookie = (req: Request): string =>
    `tksession=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookieAttr(req)}`;

  return {
    db,
    signup,
    login,
    createSession,
    sessionUser,
    destroySession,
    sessionTokenFromRequest,
    sessionUserFromRequest,
    sessionCookie,
    clearSessionCookie,
  };
}

export type AccountsDb = ReturnType<typeof createAccountsDb>;
