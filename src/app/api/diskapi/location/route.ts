import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { getDiskapiDoorForBina } from "@/lib/diskapi-lookup";

function getDb() {
  return new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"), { readOnly: true });
}

function findDoorForBina(db: DatabaseSync, binaId: number, kapiNo?: string) {
  const direct = getDiskapiDoorForBina(binaId, kapiNo);
  if (direct) return { door: direct, source_bina_id: binaId };

  const row = db.prepare(`SELECT id_2 FROM binalar WHERE id = ?`).get(binaId) as
    | { id_2: number | string | null }
    | undefined;
  const id2 = row?.id_2 != null ? String(row.id_2).trim() : "";
  if (!id2) return null;

  const siblings = db
    .prepare(`SELECT id FROM binalar WHERE id_2 = ? AND id != ?`)
    .all(id2, binaId) as Array<{ id: number }>;

  for (const s of siblings) {
    const door = getDiskapiDoorForBina(s.id, kapiNo);
    if (door) return { door, source_bina_id: s.id };
  }

  return null;
}

// GET /api/diskapi/location?bina_id=1&kapi_no=70/1
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const binaId = parseInt(searchParams.get("bina_id") || "", 10);
    if (!binaId) {
      return NextResponse.json({ error: "bina_id gerekli" }, { status: 400 });
    }

    const kapiNo = (searchParams.get("kapi_no") || "").trim();
    const db = getDb();
    const hit = findDoorForBina(db, binaId, kapiNo || undefined);
    if (!hit) {
      return NextResponse.json({ error: "Kapı konumu bulunamadı" }, { status: 404 });
    }

    const { door, source_bina_id } = hit;
    return NextResponse.json({
      bina_id: binaId,
      source_bina_id,
      kapi_no: door.kapi_no,
      lat: door.lat,
      lng: door.lng,
      alignment: door.alignment,
      edge_distance_m: door.edge_distance_m,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Kapı konumu hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
