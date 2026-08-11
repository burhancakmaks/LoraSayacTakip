import { NextResponse } from "next/server";
import { rebuildUzaktanSozlesmeIndex } from "@/lib/rebuild-uzaktan-sozlesme-index";

export async function POST() {
  try {
    const stats = rebuildUzaktanSozlesmeIndex();
    return NextResponse.json({ success: true, stats });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Uzaktan indeks yenilenemedi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
