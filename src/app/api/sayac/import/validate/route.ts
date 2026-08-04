import { NextRequest, NextResponse } from "next/server";
import { validateSayacImport } from "@/lib/sayac-excel-import";
import { openDb, savePendingUpload } from "@/lib/sayac-import-store";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXT = /\.(xlsx|xls)$/i;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Excel dosyası gerekli." }, { status: 400 });
    }

    if (!ALLOWED_EXT.test(file.name)) {
      return NextResponse.json(
        { error: "Yalnızca .xlsx veya .xls dosyaları kabul edilir." },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Dosya boyutu 15 MB sınırını aşıyor." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const db = openDb();

    try {
      const result = validateSayacImport(buffer, db, file.name);

      let pendingId: string | null = null;
      if (result.valid) {
        const pending = savePendingUpload(buffer, file.name);
        pendingId = pending.id;
      }

      return NextResponse.json({
        valid: result.valid,
        fatal: result.fatal,
        filename: file.name,
        pendingId,
        errors: result.errors,
        skipped: result.skipped,
        stats: result.stats,
        format: result.format,
        hint: result.hint,
        parsedTotal: result.parsedTotal,
        preview: result.preview.map((r) => ({
          row: r.rowNum,
          adaParsel: r.adaParsel || "—",
          blok: r.blok,
          kapiNo: r.kapiNo,
          sayac: r.sayacRaw,
          durum: r.durum,
          binaId: r.binaId,
        })),
      });
    } finally {
      db.close();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Doğrulama hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
