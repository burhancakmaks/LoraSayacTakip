import { hashSync } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthUser,
  createSessionToken,
  ensureAuthSchema,
  hasUsers,
  isLocalSetupRequest,
  setSessionCookie,
  writeAudit,
} from "@/lib/auth";

export async function GET() {
  return NextResponse.json({ available: !hasUsers() });
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET?.trim()) {
      return NextResponse.json(
        { error: "Sunucuda AUTH_SECRET tanımlanmadan ilk kurulum yapılamaz" },
        { status: 503 }
      );
    }
    if (hasUsers()) {
      return NextResponse.json({ error: "İlk kurulum daha önce tamamlandı" }, { status: 409 });
    }

    const body = await request.json();
    const suppliedToken = String(body.setupToken || "");
    const envToken = process.env.MASKI_SETUP_TOKEN;
    const tokenAllowed = !!envToken && suppliedToken === envToken;
    if (!isLocalSetupRequest(request) && !tokenAllowed) {
      return NextResponse.json(
        { error: "İlk kurulum yalnızca sunucunun yerel adresinden yapılabilir" },
        { status: 403 }
      );
    }

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLocaleLowerCase("tr-TR");
    const password = String(body.password || "");
    if (name.length < 2 || !email.includes("@") || password.length < 10) {
      return NextResponse.json(
        { error: "Geçerli ad, e-posta ve en az 10 karakterli parola gerekli" },
        { status: 400 }
      );
    }

    const db = ensureAuthSchema();
    const result = db
      .prepare(
        `INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')`
      )
      .run(email, name, hashSync(password, 12));
    const user: AuthUser = { id: Number(result.lastInsertRowid), email, name, role: "admin" };
    const response = NextResponse.json({ user }, { status: 201 });
    setSessionCookie(response, await createSessionToken(user));
    writeAudit(request, user, {
      action: "create",
      entity: "user",
      entityId: user.id,
      summary: "İlk yönetici hesabı oluşturuldu",
      after: { email, name, role: "admin" },
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Kurulum tamamlanamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
