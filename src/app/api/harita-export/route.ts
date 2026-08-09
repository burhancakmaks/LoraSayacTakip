import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { requireRole, writeAudit } from "@/lib/auth";
import {
  buildHaritaExportPayload,
  haritaExportContentType,
  haritaExportFilename,
  serializeHaritaExportBody,
  type HaritaExportFormat,
} from "@/lib/harita-export";

type DbRow = Record<string, unknown>;

function parseFormat(value: string | null): HaritaExportFormat {
  const normalized = (value || "json").toLowerCase();
  if (normalized === "kml" || normalized === "geojson" || normalized === "json") return normalized;
  return "json";
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const format = parseFormat(searchParams.get("format"));

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"), {
      readOnly: true,
    });

    const buildings = db.prepare("SELECT * FROM binalar ORDER BY id").all() as DbRow[];
    const buildingInfo = db.prepare("SELECT * FROM bina_bilgi ORDER BY bina_id").all() as DbRow[];
    const meters = db.prepare("SELECT * FROM sayac ORDER BY bina_id, birim_no, id").all() as DbRow[];
    const hasTarifeTable = Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get("bina_tarife_ozet")
    );
    const tariffs = hasTarifeTable
      ? (db.prepare("SELECT * FROM bina_tarife_ozet ORDER BY bina_id").all() as DbRow[])
      : [];

    const exportedAt = new Date().toISOString();
    const payload = buildHaritaExportPayload(buildings, buildingInfo, meters, tariffs, exportedAt);
    const body = serializeHaritaExportBody(format, payload);
    const filename = haritaExportFilename(format, exportedAt);

    writeAudit(request, auth.user, {
      action: "export",
      entity: "map",
      summary: `Harita verileri ${format.toUpperCase()} formatında dışa aktarıldı`,
      metadata: { ...payload.summary, export_format: format },
    });

    return new NextResponse(body, {
      headers: {
        "Content-Type": haritaExportContentType(format),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Encoding": "identity",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Dışa aktarım başarısız";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
