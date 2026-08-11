import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function getDb() {
  return new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
}

function centroid(coords: [number, number][][]) {
  let la = 0;
  let ln = 0;
  let n = 0;
  for (const ring of coords) {
    for (const [lat, lng] of ring) {
      la += lat;
      ln += lng;
      n++;
    }
  }
  return n ? { lat: la / n, lng: ln / n } : null;
}

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `
        SELECT
          s.bina_id,
          b.value,
          b.coordinates,
          s.sayac_id,
          s.kapi_no,
          s.blok_no,
          s.kat,
          s.updated_at
        FROM sayac s
        JOIN binalar b ON b.id = s.bina_id
        WHERE date(s.updated_at) = date('now', 'localtime')
          AND TRIM(COALESCE(s.sayac_id, '')) != ''
        ORDER BY s.updated_at DESC
      `
      )
      .all() as Array<{
      bina_id: number;
      value: string;
      coordinates: string;
      sayac_id: string;
      kapi_no: string;
      blok_no: string;
      kat: string;
      updated_at: string;
    }>;

    const binaMap = new Map<
      number,
      {
        bina_id: number;
        value: string;
        coordinates: string;
        count: number;
        last_at: string;
        items: Array<{
          sayac_id: string;
          kapi_no: string;
          blok_no: string;
          kat: string;
          updated_at: string;
        }>;
      }
    >();

    for (const row of rows) {
      let entry = binaMap.get(row.bina_id);
      if (!entry) {
        entry = {
          bina_id: row.bina_id,
          value: row.value,
          coordinates: row.coordinates,
          count: 0,
          last_at: row.updated_at,
          items: [],
        };
        binaMap.set(row.bina_id, entry);
      }
      entry.count++;
      if (entry.items.length < 12) {
        entry.items.push({
          sayac_id: row.sayac_id,
          kapi_no: row.kapi_no,
          blok_no: row.blok_no,
          kat: row.kat,
          updated_at: row.updated_at,
        });
      }
      if (row.updated_at > entry.last_at) entry.last_at = row.updated_at;
    }

    const binalar = [...binaMap.values()].map((entry) => {
      const coords = JSON.parse(entry.coordinates) as [number, number][][];
      return {
        bina_id: entry.bina_id,
        value: entry.value,
        count: entry.count,
        last_at: entry.last_at,
        center: centroid(coords),
        items: entry.items,
      };
    });

    binalar.sort((a, b) => b.count - a.count);

    return NextResponse.json({
      date: new Date().toISOString().slice(0, 10),
      ozet: {
        toplam: rows.length,
        bina_sayisi: binalar.length,
      },
      binalar,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bugünkü kayıtlar alınamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
