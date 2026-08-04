import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { requireRole, writeAudit } from "@/lib/auth";

type DbRow = Record<string, unknown>;

function parseCoordinates(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;

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

    const infoByBuilding = new Map(buildingInfo.map((row) => [Number(row.bina_id), row]));
    const tariffByBuilding = new Map(tariffs.map((row) => [Number(row.bina_id), row]));
    const metersByBuilding = new Map<number, DbRow[]>();
    for (const meter of meters) {
      const buildingId = Number(meter.bina_id);
      const current = metersByBuilding.get(buildingId) ?? [];
      current.push(meter);
      metersByBuilding.set(buildingId, current);
    }

    const exportedAt = new Date().toISOString();
    const payload = {
      format: "LoraSayacTakip.HaritaExport",
      version: 1,
      exported_at: exportedAt,
      summary: {
        building_count: buildings.length,
        meter_record_count: meters.length,
        building_info_count: buildingInfo.length,
        tariff_record_count: tariffs.length,
      },
      buildings: buildings.map((building) => {
        const id = Number(building.id);
        return {
          ...building,
          coordinates: parseCoordinates(building.coordinates),
          building_info: infoByBuilding.get(id) ?? null,
          tariff: tariffByBuilding.get(id) ?? null,
          meters: metersByBuilding.get(id) ?? [],
        };
      }),
    };

    writeAudit(request, auth.user, {
      action: "export",
      entity: "map",
      summary: "Harita verileri JSON formatında dışa aktarıldı",
      metadata: payload.summary,
    });

    const date = exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="harita-verileri-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "JSON dışa aktarımı başarısız";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
