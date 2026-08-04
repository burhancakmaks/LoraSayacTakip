import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function getDb() {
  return new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
}

export async function GET() {
  try {
    const db = getDb();
    const ozet = db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM binalar) AS toplam_bina,
        (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '') AS toplam_sayac,
        (SELECT COUNT(*) FROM sayac) AS birim_kaydi,
        (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(abone_no,'')) != '') AS abone_nolu
    `
      )
      .get() as {
      toplam_bina: number;
      toplam_sayac: number;
      birim_kaydi: number;
      abone_nolu: number;
    };

    return NextResponse.json(ozet);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Özet yüklenemedi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
