import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const PRESENTATION_SOURCES = [
  "37-50 ADA E BLOK 72 ADET MASKİ ABONELİK (1).XLS",
  "ŞİRE PAZARI MASKİ ABONELİKLERİ.xlsx",
  "53 ADA MASKİ ABONELERİ.xlsx",
  "49 ADA 301 ADET  MASKİ ABONELİK (1).xlsx",
  "41-134   341 ADET  maski abonelik.xlsx",
  "46 ADA KONUT MASKİ ABONELERİ.xlsx",
  "4.ETAP TS SAYAÇ NO.xlsx",
  "37-50 ADA A-B BLOK 344 ADETMASKİ ABONELİK.xlsx",
];

export async function GET() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"), { readOnly: true });
  try {
    const placeholders = PRESENTATION_SOURCES.map(() => "?").join(",");
    const sourceSummary = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN e.bina_id IS NOT NULL AND b.layer <> 'MASKI_EXCEL_ABONELIK_YAKLASIK' THEN 1 ELSE 0 END) AS linked
      FROM excel_abonelikler e LEFT JOIN binalar b ON b.id=e.bina_id
      WHERE e.kaynak_dosya IN (${placeholders})
    `).get(...PRESENTATION_SOURCES) as { total: number; linked: number };
    const buildingSummary = db.prepare(`
      SELECT COUNT(DISTINCT s.bina_id) AS metered
      FROM sayac s JOIN binalar b ON b.id=s.bina_id
      WHERE b.layer <> 'MASKI_EXCEL_ABONELIK_YAKLASIK'
        AND TRIM(COALESCE(s.sayac_id,'')) <> ''
    `).get() as { metered: number };

    return NextResponse.json({
      totalMeters: sourceSummary.total,
      linkedMeters: sourceSummary.linked,
      pendingMeters: sourceSummary.total - sourceSummary.linked,
      meteredBuildings: buildingSummary.metered,
    });
  } finally {
    db.close();
  }
}
