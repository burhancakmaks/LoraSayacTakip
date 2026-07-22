import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function getDb() {
  const dbPath = path.join(process.cwd(), "data", "binalar.db");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bina_bilgi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bina_id INTEGER NOT NULL UNIQUE,
      kat_sayisi INTEGER NOT NULL DEFAULT 0,
      daire_sayisi INTEGER NOT NULL DEFAULT 0,
      ortak_alan_sayisi INTEGER NOT NULL DEFAULT 0,
      toplam_bagımsız_bolum INTEGER NOT NULL DEFAULT 0,
      has_zemin INTEGER NOT NULL DEFAULT 0,
      ada_parsel TEXT DEFAULT '',
      sokak TEXT DEFAULT '',
      dis_kapi_no TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Safe migrations for adding columns to existing database
  try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN daire_sayisi INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN has_zemin INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN ada_parsel TEXT DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN sokak TEXT DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN dis_kapi_no TEXT DEFAULT ''`); } catch {}

  return db;
}

export async function GET(request: NextRequest) {
  let db: DatabaseSync | null = null;
  try {
    const { searchParams } = new URL(request.url);
    const bina_id = searchParams.get("bina_id");
    if (!bina_id) return NextResponse.json({ error: "bina_id gerekli" }, { status: 400 });

    db = getDb();
    const id = parseInt(bina_id);
    const row = db.prepare("SELECT * FROM bina_bilgi WHERE bina_id = ?").get(id) as Record<string, unknown> | undefined;
    const excel = db.prepare(`
      SELECT
        COUNT(*) AS kayit_sayisi,
        COUNT(DISTINCT NULLIF(TRIM(kat), '')) AS kat_sayisi,
        COUNT(DISTINCT NULLIF(TRIM(daire), '')) AS daire_sayisi,
        MAX(CASE WHEN UPPER(kat) LIKE '%ZEM%' THEN 1 ELSE 0 END) AS has_zemin,
        MIN(NULLIF(TRIM(ada), '')) AS ada_parsel,
        MIN(NULLIF(TRIM(adres), '')) AS adres
      FROM excel_abonelikler WHERE bina_id = ?
    `).get(id) as Record<string, unknown>;

    if (!Number(excel.kayit_sayisi || 0)) {
      const meter = db.prepare(`
        SELECT COUNT(*) AS kayit_sayisi,
          COUNT(DISTINCT NULLIF(TRIM(kat), '')) AS kat_sayisi,
          COUNT(DISTINCT NULLIF(TRIM(kapi_no), '')) AS daire_sayisi,
          MAX(CASE WHEN UPPER(kat) LIKE '%ZEM%' THEN 1 ELSE 0 END) AS has_zemin
        FROM sayac WHERE bina_id=?
      `).get(id) as Record<string, unknown>;
      const building = db.prepare("SELECT COALESCE(aktif_abone_sayisi,0) AS aktif_abone_sayisi FROM binalar WHERE id=?").get(id) as { aktif_abone_sayisi: number } | undefined;
      if (!row && !Number(meter.kayit_sayisi || 0) && !Number(building?.aktif_abone_sayisi || 0)) return NextResponse.json(null);
      const existing = row || {};
      return NextResponse.json({
        ...existing,
        bina_id: id,
        kat_sayisi: Number(existing.kat_sayisi || 0) || Number(meter.kat_sayisi || 0),
        daire_sayisi: Number(existing.daire_sayisi || 0) || Number(meter.daire_sayisi || 0) || Number(meter.kayit_sayisi || 0),
        ortak_alan_sayisi: Number(existing.ortak_alan_sayisi || 0),
        has_zemin: Number(existing.has_zemin || 0) || Number(meter.has_zemin || 0),
        ada_parsel: String(existing.ada_parsel || ""),
        sokak: String(existing.sokak || ""),
        dis_kapi_no: String(existing.dis_kapi_no || ""),
        sayac_kayit_sayisi: Number(meter.kayit_sayisi || 0),
        aktif_abone_sayisi: Number(building?.aktif_abone_sayisi || 0),
        veri_kaynagi: "mevcut_sayac",
        adres_durumu: Number(meter.kayit_sayisi || 0)
          ? "Sayaç detayı mevcut; Excel adres eşleşmesi bulunamadı"
          : `Yalnızca aktif abone toplamı mevcut (${Number(building?.aktif_abone_sayisi || 0)}); kimlik ve adres detayı kaynakta yok`,
      });
    }
    const address = String(excel.adres || "");
    const street = address.match(/([^,]+?(?:SOKAK|SOKAĞI|CADDE|CADDESİ|BULVAR|BULVARI))/i)?.[1]?.trim() || "";
    const door = address.match(/(?:NO|NO:|NO\s)\s*([0-9]+[A-ZÇĞİÖŞÜ/-]*)/i)?.[1] || "";
    const existing = row || {};
    const textOrExcel = (key: string, fallback: unknown) => String(existing[key] || "").trim() || fallback || "";
    const numberOrExcel = (key: string, fallback: unknown) => Number(existing[key] || 0) || Number(fallback || 0);

    return NextResponse.json({
      ...existing,
      bina_id: id,
      kat_sayisi: numberOrExcel("kat_sayisi", excel.kat_sayisi),
      daire_sayisi: numberOrExcel("daire_sayisi", excel.daire_sayisi),
      ortak_alan_sayisi: Number(existing.ortak_alan_sayisi || 0),
      has_zemin: numberOrExcel("has_zemin", excel.has_zemin),
      ada_parsel: textOrExcel("ada_parsel", excel.ada_parsel),
      sokak: textOrExcel("sokak", street),
      dis_kapi_no: textOrExcel("dis_kapi_no", door),
      excel_kayit_sayisi: Number(excel.kayit_sayisi),
      excel_adres: address,
      veri_kaynagi: "excel_birebir",
      adres_durumu: "Excel adresiyle eşleşti",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db?.close();
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      bina_id, 
      kat_sayisi, 
      daire_sayisi, 
      ortak_alan_sayisi, 
      has_zemin, 
      ada_parsel, 
      sokak, 
      dis_kapi_no 
    } = body;
    
    if (!bina_id) return NextResponse.json({ error: "bina_id gerekli" }, { status: 400 });

    const toplam = (daire_sayisi || 0) + (ortak_alan_sayisi || 0);
    const db = getDb();

    db.prepare(`
      INSERT INTO bina_bilgi (
        bina_id, 
        kat_sayisi, 
        daire_sayisi, 
        ortak_alan_sayisi, 
        toplam_bagımsız_bolum, 
        has_zemin, 
        ada_parsel, 
        sokak, 
        dis_kapi_no, 
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(bina_id) DO UPDATE SET
        kat_sayisi = excluded.kat_sayisi,
        daire_sayisi = excluded.daire_sayisi,
        ortak_alan_sayisi = excluded.ortak_alan_sayisi,
        toplam_bagımsız_bolum = excluded.toplam_bagımsız_bolum,
        has_zemin = excluded.has_zemin,
        ada_parsel = excluded.ada_parsel,
        sokak = excluded.sokak,
        dis_kapi_no = excluded.dis_kapi_no,
        updated_at = datetime('now')
    `).run(
      bina_id, 
      kat_sayisi || 0, 
      daire_sayisi || 0, 
      ortak_alan_sayisi || 0, 
      toplam, 
      has_zemin ? 1 : 0,
      ada_parsel || "",
      sokak || "",
      dis_kapi_no || ""
    );

    return NextResponse.json({ success: true, toplam_bagımsız_bolum: toplam });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
