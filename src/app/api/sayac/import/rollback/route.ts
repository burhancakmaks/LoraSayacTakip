import { NextRequest, NextResponse } from "next/server";
import { rollbackLastImport } from "@/lib/sayac-import-store";
import { requireRole, writeAudit } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;
  try {
    const result = rollbackLastImport();
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    writeAudit(request, auth.user, {
      action: "rollback",
      entity: "sayac_import",
      summary: result.message,
    });
    return NextResponse.json({ ok: true, message: result.message });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Geri alma hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
