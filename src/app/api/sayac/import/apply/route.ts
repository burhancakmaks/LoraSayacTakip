import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { validateSayacImport, applySayacImport } from "@/lib/sayac-excel-import";
import { extractPendingUploadFilename } from "@/lib/sayac-import-filename";
import {
  openDb,
  createBackup,
  loadHistory,
  saveHistory,
  getPendingUpload,
  removePendingUpload,
} from "@/lib/sayac-import-store";
import { requireRole, writeAudit } from "@/lib/auth";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXT = /\.(xlsx|xls)$/i;

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;
  try {
    const form = await request.formData();
    const pendingId = String(form.get("pendingId") ?? "").trim();
    const originalFilename = String(form.get("filename") ?? "").trim();
    const file = form.get("file");

    let buffer: Buffer;
    let filename: string;
    let uploadPath: string | undefined;

    if (pendingId) {
      const path = getPendingUpload(pendingId);
      if (!path) {
        return NextResponse.json(
          { error: "Doğrulama oturumu süresi dolmuş. Dosyayı yeniden yükleyin." },
          { status: 400 }
        );
      }
      buffer = readFileSync(path);
      filename = originalFilename || extractPendingUploadFilename(path);
      uploadPath = path;
    } else if (file && file instanceof File) {
      if (!ALLOWED_EXT.test(file.name)) {
        return NextResponse.json({ error: "Yalnızca .xlsx veya .xls dosyaları kabul edilir." }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "Dosya boyutu 15 MB sınırını aşıyor." }, { status: 400 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
    } else {
      return NextResponse.json({ error: "pendingId veya dosya gerekli." }, { status: 400 });
    }

    const db = openDb();
    try {
      const validation = validateSayacImport(buffer, db, filename);
      if (!validation.valid) {
        return NextResponse.json(
          {
            error: validation.fatal
              ? validation.errors[0]?.message ?? "Dosya okunamadı."
              : "Aktarılacak geçerli satır bulunamadı.",
            errors: validation.errors,
            skipped: validation.skipped,
            stats: validation.stats,
          },
          { status: 422 }
        );
      }

      const backupPath = createBackup();
      const stats = applySayacImport(db, validation.importableRows);

      const entry = {
        id: `import-${Date.now()}`,
        timestamp: new Date().toISOString(),
        filename,
        backupPath,
        uploadPath,
        stats: { ...stats, skipped_rows: validation.stats.skipped } as unknown as Record<string, number>,
        rowCount: validation.importableRows.length,
      };
      saveHistory({ last: entry });

      writeAudit(request, auth.user, {
        action: "import",
        entity: "sayac_import",
        entityId: entry.id,
        summary: `${filename} dosyasından sayaç aktarımı yapıldı`,
        metadata: {
          filename,
          backupPath,
          rowCount: validation.importableRows.length,
          skipped: validation.stats.skipped,
          stats,
        },
      });

      const { tryRebuildUzaktanSozlesmeIndex } = await import("@/lib/rebuild-uzaktan-sozlesme-index");
      const uzaktan_stats = tryRebuildUzaktanSozlesmeIndex();

      return NextResponse.json({
        ok: true,
        message: `Aktarım tamamlandı: ${stats.inserted} yeni, ${stats.updated} güncellendi${
          validation.stats.skipped ? `, ${validation.stats.skipped} satır atlandı` : ""
        }.`,
        import: entry,
        stats,
        skipped: validation.skipped,
        uzaktan_stats,
      });
    } finally {
      db.close();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Aktarım hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
