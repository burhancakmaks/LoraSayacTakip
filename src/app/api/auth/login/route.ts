import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  createSessionToken,
  setSessionCookie,
  writeAudit,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (!email || !password) {
      return NextResponse.json({ error: "E-posta ve parola gerekli" }, { status: 400 });
    }

    const user = await authenticate(email, password);
    if (!user) {
      return NextResponse.json({ error: "E-posta veya parola hatalı" }, { status: 401 });
    }

    const token = await createSessionToken(user);
    const response = NextResponse.json({ user });
    setSessionCookie(response, token);
    writeAudit(request, user, {
      action: "login",
      entity: "session",
      entityId: user.id,
      summary: "Oturum açıldı",
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Giriş yapılamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
