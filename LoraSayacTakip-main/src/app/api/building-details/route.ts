import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const runtime = "nodejs";

type ImportedBuildingRow = {
  ada: string;
  blok: string;
  dis_kapi_no: string;
  adres: string;
  mahalle: string;
  kat_sayisi: number;
  katlar_json: string;
  daire_sayisi: number;
  daireler_json: string;
  abonelikler_json: string;
  toplam_kayit_sayisi: number;
};

function response(row: ImportedBuildingRow) {
  return {
    ada: row.ada,
    blok: row.blok,
    disKapiNo: row.dis_kapi_no,
    adres: row.adres,
    mahalle: row.mahalle,
    katSayisi: row.kat_sayisi,
    katlar: JSON.parse(row.katlar_json),
    toplamDaireSayisi: row.daire_sayisi,
    daireler: JSON.parse(row.daireler_json),
    toplamKayitSayisi: row.toplam_kayit_sayisi,
    abonelikler: JSON.parse(row.abonelikler_json),
  };
}

export async function GET(request: NextRequest) {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"), { readOnly: true });
  try {
    const params = request.nextUrl.searchParams;
    const ada = params.get("ada")?.trim() || "";
    const blok = params.get("blok")?.trim() || params.get("disKapiNo")?.trim() || "";
    const binaId = Number(params.get("binaId") || 0);

    let row: ImportedBuildingRow | undefined;
    if (ada && blok) {
      row = db.prepare(`
        SELECT * FROM imported_buildings
        WHERE ada = ? COLLATE NOCASE
          AND (blok = ? COLLATE NOCASE OR dis_kapi_no = ? COLLATE NOCASE)
        LIMIT 1
      `).get(ada, blok, blok) as ImportedBuildingRow | undefined;
    } else if (binaId) {
      row = db.prepare(`
        SELECT ib.* FROM imported_buildings ib
        JOIN excel_abonelikler ea
          ON ea.ada = ib.ada COLLATE NOCASE AND ea.blok = ib.blok COLLATE NOCASE
        WHERE ea.bina_id = ? LIMIT 1
      `).get(binaId) as ImportedBuildingRow | undefined;
    } else {
      return NextResponse.json({ error: "ada ve blok (veya disKapiNo) gerekli" }, { status: 400 });
    }

    if (!row) return NextResponse.json({ error: "Bina bulunamadı" }, { status: 404 });
    return NextResponse.json(response(row));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bina bilgileri okunamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db.close();
  }
}
