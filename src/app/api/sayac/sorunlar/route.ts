import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { buildingSorunSeverity } from "@/lib/sayac-durum";

function getDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN sayac_durum TEXT DEFAULT 'gecerli'`);
  } catch {}
  return db;
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
  return n ? ([la / n, ln / n] as [number, number]) : null;
}

export async function GET() {
  try {
    const db = getDb();

    const rows = db
      .prepare(
        `
        SELECT
          b.id AS bina_id,
          b.value,
          b.coordinates,
          SUM(CASE WHEN COALESCE(s.sayac_durum, 'gecerli') = 'okunmadi' THEN 1 ELSE 0 END) AS okunmadi,
          SUM(CASE WHEN COALESCE(s.sayac_durum, 'gecerli') = 'eksik' THEN 1 ELSE 0 END) AS eksik,
          SUM(CASE WHEN COALESCE(s.sayac_durum, 'gecerli') = 'hatali' THEN 1 ELSE 0 END) AS hatali,
          SUM(CASE WHEN COALESCE(s.sayac_durum, 'gecerli') = 'gecerli' THEN 1 ELSE 0 END) AS gecerli
        FROM sayac s
        JOIN binalar b ON b.id = s.bina_id
        GROUP BY b.id
        HAVING okunmadi > 0 OR eksik > 0 OR hatali > 0
      `
      )
      .all() as any[];

    const binalar = rows.map((row) => {
      const counts = {
        okunmadi: row.okunmadi,
        eksik: row.eksik,
        hatali: row.hatali,
      };
      const coords = JSON.parse(row.coordinates) as [number, number][][];
      return {
        bina_id: row.bina_id,
        value: row.value,
        okunmadi: row.okunmadi,
        eksik: row.eksik,
        hatali: row.hatali,
        gecerli: row.gecerli,
        severity: buildingSorunSeverity(counts),
        center: centroid(coords),
      };
    });

    const ozet = binalar.reduce(
      (acc, b) => {
        acc.okunmadi += b.okunmadi;
        acc.eksik += b.eksik;
        acc.hatali += b.hatali;
        acc.bina_sayisi += 1;
        if (b.severity === "kritik") acc.kritik_bina += 1;
        if (b.severity === "eksik") acc.eksik_bina += 1;
        return acc;
      },
      { okunmadi: 0, eksik: 0, hatali: 0, bina_sayisi: 0, kritik_bina: 0, eksik_bina: 0 }
    );

    return NextResponse.json({ ozet, binalar });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
