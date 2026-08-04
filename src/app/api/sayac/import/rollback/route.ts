import { NextResponse } from "next/server";
import { rollbackLastImport } from "@/lib/sayac-import-store";

export async function POST() {
  try {
    const result = rollbackLastImport();
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: result.message });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Geri alma hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
