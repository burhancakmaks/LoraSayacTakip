import { compare, hashSync } from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const USER_ROLES = ["viewer", "editor", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | number | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  success?: boolean;
}

const SESSION_COOKIE = "maski_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const ROLE_LEVEL: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };
const globalForAuth = globalThis as typeof globalThis & { maskiAuthDb?: DatabaseSync };

function getDb() {
  // Kimlik ve denetim verileri ana sayaç veritabanından fiziksel olarak ayrıdır.
  // Böylece yetkilendirme kurulumu mevcut bina/sayaç kayıtlarını değiştirmez.
  if (!globalForAuth.maskiAuthDb) {
    globalForAuth.maskiAuthDb = new DatabaseSync(path.join(process.cwd(), "data", "auth.db"));
  }
  return globalForAuth.maskiAuthDb;
}

function getSecret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (value) return new TextEncoder().encode(value);
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET tanımlanmadı");
  }
  return new TextEncoder().encode("maski-local-development-secret-change-in-production");
}

export function ensureAuthSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'editor', 'admin')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_email TEXT NOT NULL,
      user_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      summary TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      metadata_json TEXT,
      ip TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now');
  `);

  const count = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  const email = process.env.MASKI_ADMIN_EMAIL?.trim().toLocaleLowerCase("tr-TR");
  const password = process.env.MASKI_ADMIN_PASSWORD;
  if (count === 0 && email && password && password.length >= 10) {
    db.prepare(
      `INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')`
    ).run(email, process.env.MASKI_ADMIN_NAME?.trim() || "MASKİ Yöneticisi", hashSync(password, 12));
  }
  return db;
}

export function hasUsers() {
  const db = ensureAuthSchema();
  return (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count > 0;
}

export function canAccess(actual: UserRole, required: UserRole) {
  return ROLE_LEVEL[actual] >= ROLE_LEVEL[required];
}

export async function createSessionToken(user: AuthUser) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const db = ensureAuthSchema();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(
    sessionId,
    user.id,
    expiresAt
  );
  return new SignJWT({ email: user.email, name: user.name, role: user.role, sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionFromRequest(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const id = Number(payload.sub);
    const sessionId = typeof payload.sid === "string" ? payload.sid : "";
    if (!id || !sessionId || !USER_ROLES.includes(payload.role as UserRole)) return null;
    const db = ensureAuthSchema();
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND u.id = ? AND u.active = 1
           AND datetime(s.expires_at) > datetime('now')`
      )
      .get(sessionId, id) as AuthUser | undefined;
    if (row) {
      db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(sessionId);
    }
    return row ?? null;
  } catch {
    return null;
  }
}

export async function revokeSessionFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sid === "string") {
      ensureAuthSchema().prepare("DELETE FROM sessions WHERE id = ?").run(payload.sid);
    }
  } catch {
    // Süresi dolmuş veya bozuk çerez zaten geçersizdir.
  }
}

export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const db = ensureAuthSchema();
  const row = db
    .prepare("SELECT id, email, name, role, password_hash, active FROM users WHERE email = ?")
    .get(email.trim().toLocaleLowerCase("tr-TR")) as
    | (AuthUser & { password_hash: string; active: number })
    | undefined;
  if (!row?.active || !(await compare(password, row.password_hash))) return null;
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function requireRole(
  request: NextRequest,
  required: UserRole = "viewer"
): Promise<{ user: AuthUser; response?: never } | { user?: never; response: NextResponse }> {
  const user = await getSessionFromRequest(request);
  if (!user) {
    return { response: NextResponse.json({ error: "Oturum açmanız gerekiyor" }, { status: 401 }) };
  }
  if (!canAccess(user.role, required)) {
    return { response: NextResponse.json({ error: "Bu işlem için yetkiniz yok" }, { status: 403 }) };
  }
  return { user };
}

function jsonValue(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

export function writeAudit(request: NextRequest, user: AuthUser, input: AuditInput) {
  const db = ensureAuthSchema();
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  db.prepare(
    `INSERT INTO audit_logs (
      user_id, user_email, user_role, action, entity, entity_id, summary,
      before_json, after_json, metadata_json, ip, success
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    user.id,
    user.email,
    user.role,
    input.action,
    input.entity,
    input.entityId == null ? null : String(input.entityId),
    input.summary,
    jsonValue(input.before),
    jsonValue(input.after),
    jsonValue(input.metadata),
    ip,
    input.success === false ? 0 : 1
  );
}

export function isLocalSetupRequest(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const localIp = !forwarded || forwarded === "127.0.0.1" || forwarded === "::1";
  return localHost && localIp;
}

export { SESSION_COOKIE };
