import { hashSync } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { ensureAuthSchema, isLocalSetupRequest, type AuthUser, writeAudit } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLocaleLowerCase("tr-TR");
    const password = String(body.password || "");
    const suppliedToken = String(body.recoveryToken || "");
    const envToken = process.env.MASKI_RECOVERY_TOKEN;
    const tokenAllowed = !!envToken && suppliedToken === envToken;

    if (!isLocalSetupRequest(request) && !tokenAllowed) {
      return NextResponse.json(
        { error: "Uzak parola kurtarma için geçerli kurtarma anahtarı gerekli" },
        { status: 403 }
      );
    }
    if (!email.includes("@") || password.length < 10) {
      return NextResponse.json(
        { error: "Geçerli e-posta ve en az 10 karakterli yeni parola gerekli" },
        { status: 400 }
      );
    }

    const db = ensureAuthSchema();
    const user = db
      .prepare("SELECT id, email, name, role FROM users WHERE email = ? AND active = 1")
      .get(email) as AuthUser | undefined;
    if (!user) {
      return NextResponse.json({ error: "Etkin kullanıcı hesabı bulunamadı" }, { status: 404 });
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(hashSync(password, 12), user.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    writeAudit(request, user, {
      action: "password_reset",
      entity: "user",
      entityId: user.id,
      summary: "Parola güvenli kurtarma akışıyla yenilendi",
      metadata: { localRecovery: isLocalSetupRequest(request) },
    });
    return NextResponse.json({
      success: true,
      message: "Parolanız yenilendi. Yeni parolanızla giriş yapabilirsiniz.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Parola yenilenemedi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
