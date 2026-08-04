import { hashSync } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAuthSchema,
  requireRole,
  USER_ROLES,
  type UserRole,
  writeAudit,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;
  const db = ensureAuthSchema();
  const users = db
    .prepare(
      `SELECT id, email, name, role, active, created_at, updated_at, last_login_at
       FROM users ORDER BY active DESC, name COLLATE NOCASE`
    )
    .all();
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLocaleLowerCase("tr-TR");
    const password = String(body.password || "");
    const role = String(body.role || "viewer") as UserRole;
    if (name.length < 2 || !email.includes("@") || password.length < 10 || !USER_ROLES.includes(role)) {
      return NextResponse.json({ error: "Kullanıcı bilgileri geçersiz" }, { status: 400 });
    }

    const db = ensureAuthSchema();
    const result = db
      .prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)")
      .run(email, name, hashSync(password, 12), role);
    const id = Number(result.lastInsertRowid);
    writeAudit(request, auth.user, {
      action: "create",
      entity: "user",
      entityId: id,
      summary: `${name} kullanıcısı oluşturuldu`,
      after: { email, name, role, active: true },
    });
    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Kullanıcı oluşturulamadı";
    const duplicate = message.toLowerCase().includes("unique");
    return NextResponse.json(
      { error: duplicate ? "Bu e-posta zaten kullanılıyor" : message },
      { status: duplicate ? 409 : 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const id = Number(body.id);
    if (!id) return NextResponse.json({ error: "Kullanıcı kimliği gerekli" }, { status: 400 });

    const db = ensureAuthSchema();
    const before = db
      .prepare("SELECT id, email, name, role, active FROM users WHERE id = ?")
      .get(id) as { id: number; email: string; name: string; role: UserRole; active: number } | undefined;
    if (!before) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

    const name = body.name === undefined ? before.name : String(body.name).trim();
    const role = body.role === undefined ? before.role : (String(body.role) as UserRole);
    const active = body.active === undefined ? before.active : body.active ? 1 : 0;
    if (!name || !USER_ROLES.includes(role)) {
      return NextResponse.json({ error: "Kullanıcı bilgileri geçersiz" }, { status: 400 });
    }
    if (id === auth.user.id && (!active || role !== "admin")) {
      return NextResponse.json(
        { error: "Kendi yönetici yetkinizi kaldıramazsınız" },
        { status: 400 }
      );
    }

    const password = String(body.password || "");
    if (password && password.length < 10) {
      return NextResponse.json({ error: "Parola en az 10 karakter olmalı" }, { status: 400 });
    }
    if (password) {
      db.prepare(
        `UPDATE users SET name = ?, role = ?, active = ?, password_hash = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(name, role, active, hashSync(password, 12), id);
    } else {
      db.prepare(
        `UPDATE users SET name = ?, role = ?, active = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(name, role, active, id);
    }
    if (role !== before.role || active !== before.active || password) {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    }

    writeAudit(request, auth.user, {
      action: "update",
      entity: "user",
      entityId: id,
      summary: `${before.name} kullanıcısı güncellendi`,
      before: { name: before.name, role: before.role, active: !!before.active },
      after: { name, role, active: !!active, passwordChanged: !!password },
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Kullanıcı güncellenemedi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
