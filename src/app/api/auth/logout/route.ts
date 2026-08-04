import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionFromRequest,
  revokeSessionFromRequest,
  writeAudit,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const user = await getSessionFromRequest(request);
  await revokeSessionFromRequest(request);
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  if (user) {
    writeAudit(request, user, {
      action: "logout",
      entity: "session",
      entityId: user.id,
      summary: "Oturum kapatıldı",
    });
  }
  return response;
}
