import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { classifySayacDurum } from "@/lib/sayac-durum";
import { createBildirim, getBildirimDb } from "@/lib/bildirim";
import { requireRole, writeAudit } from "@/lib/auth";

function getDb() {
  const dbPath = path.join(process.cwd(), "data", "binalar.db");
  const db = new DatabaseSync(dbPath);

  // Re-create/ensure the tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sayac (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bina_id INTEGER NOT NULL,
      birim_no INTEGER NOT NULL,
      blok_no TEXT DEFAULT '',
      kat TEXT DEFAULT '',
      kapi_no TEXT DEFAULT '',
      oda_sayisi TEXT DEFAULT 'YOK',
      kullanilis_sekli TEXT DEFAULT 'DAİRE',
      sayac_markasi TEXT DEFAULT '',
      sayac_id TEXT DEFAULT '',
      sicil_no TEXT DEFAULT '',
      abone_no TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(bina_id, birim_no)
    )
  `);

  // Safe migrations for adding columns to existing database
  try { db.exec(`ALTER TABLE sayac ADD COLUMN blok_no TEXT DEFAULT ''`); } catch (e) {}
  try { db.exec(`ALTER TABLE sayac ADD COLUMN kat TEXT DEFAULT ''`); } catch (e) {}
  try { db.exec(`ALTER TABLE sayac ADD COLUMN kapi_no TEXT DEFAULT ''`); } catch (e) {}
  try { db.exec(`ALTER TABLE sayac ADD COLUMN oda_sayisi TEXT DEFAULT 'YOK'`); } catch (e) {}
  try { db.exec(`ALTER TABLE sayac ADD COLUMN kullanilis_sekli TEXT DEFAULT 'DAİRE'`); } catch (e) {}
  try { db.exec(`ALTER TABLE sayac ADD COLUMN sicil_no TEXT DEFAULT ''`); } catch (e) {}
  try { db.exec(`ALTER TABLE sayac ADD COLUMN abone_no TEXT DEFAULT ''`); } catch (e) {}
  try { db.exec(`ALTER TABLE sayac ADD COLUMN sayac_durum TEXT DEFAULT 'gecerli'`); } catch (e) {}

  return db;
}

// GET /api/sayac?bina_id=X
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bina_id = searchParams.get("bina_id");
    if (!bina_id) return NextResponse.json({ error: "bina_id gerekli" }, { status: 400 });

    const db = getDb();
    const rows = db.prepare(`
      SELECT 
        birim_no, 
        blok_no,
        kat, 
        kapi_no, 
        oda_sayisi, 
        kullanilis_sekli, 
        sayac_markasi, 
        sayac_id,
        sicil_no,
        abone_no,
        COALESCE(sayac_durum, 'gecerli') AS sayac_durum
      FROM sayac 
      WHERE bina_id = ? 
      ORDER BY birim_no ASC
    `).all(parseInt(bina_id)) as any[];

    return NextResponse.json(rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/sayac
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const { bina_id, rows } = body;

    if (!bina_id || !Array.isArray(rows)) {
      return NextResponse.json({ error: "bina_id ve rows gerekli" }, { status: 400 });
    }

    const db = getDb();
    const building = db.prepare(`SELECT value FROM binalar WHERE id = ?`).get(bina_id) as { value: string } | undefined;
    const oldRows = db
      .prepare(`SELECT birim_no, sayac_id, COALESCE(sayac_durum, 'gecerli') AS sayac_durum FROM sayac WHERE bina_id = ?`)
      .all(bina_id) as Array<{ birim_no: number; sayac_id: string; sayac_durum: string }>;
    const oldMap = new Map(oldRows.map((r) => [r.birim_no, r]));

    const bildirimDb = getBildirimDb();
    const yeniBildirimler: ReturnType<typeof createBildirim>[] = [];

    const stmt = db.prepare(`
      INSERT INTO sayac (
        bina_id, 
        birim_no, 
        blok_no,
        kat, 
        kapi_no, 
        oda_sayisi, 
        kullanilis_sekli, 
        sayac_markasi, 
        sayac_id, 
        sicil_no,
        abone_no,
        sayac_durum,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(bina_id, birim_no) DO UPDATE SET
        blok_no = excluded.blok_no,
        kat = excluded.kat,
        kapi_no = excluded.kapi_no,
        oda_sayisi = excluded.oda_sayisi,
        kullanilis_sekli = excluded.kullanilis_sekli,
        sayac_markasi = excluded.sayac_markasi,
        sayac_id = excluded.sayac_id,
        sicil_no = excluded.sicil_no,
        abone_no = excluded.abone_no,
        sayac_durum = excluded.sayac_durum,
        updated_at = datetime('now')
    `);

    for (const row of rows) {
      const durum = classifySayacDurum(row.sayac_id);
      const old = oldMap.get(row.birim_no);
      const oldDurum = old?.sayac_durum || classifySayacDurum(old?.sayac_id);

      if (durum !== oldDurum) {
        const konum = [row.kapi_no && `Daire ${row.kapi_no}`, row.kullanilis_sekli].filter(Boolean).join(" · ");
        const binaAd = building?.value || "Bina";
        if (durum !== "gecerli") {
          yeniBildirimler.push(
            createBildirim(bildirimDb, {
              tip: durum,
              mesaj: `${binaAd}${konum ? ` — ${konum}` : ""}`,
              bina_id,
              birim_no: row.birim_no,
            })
          );
        } else if (oldDurum !== "gecerli") {
          yeniBildirimler.push(
            createBildirim(bildirimDb, {
              tip: "duzeltildi",
              mesaj: `${binaAd}${konum ? ` — ${konum}` : ""} sayaç kaydı düzeltildi`,
              bina_id,
              birim_no: row.birim_no,
            })
          );
        }
      }

      stmt.run(
        bina_id, 
        row.birim_no, 
        row.blok_no || "",
        row.kat || "", 
        row.kapi_no || "", 
        row.oda_sayisi || "YOK", 
        row.kullanilis_sekli || "DAİRE", 
        row.sayac_markasi || "", 
        row.sayac_id || "",
        row.sicil_no || "",
        row.abone_no || "",
        durum
      );
    }

    const sayacStats = db
      .prepare(
        `
      SELECT
        COUNT(*) AS sayac_kayit,
        SUM(CASE WHEN TRIM(COALESCE(sayac_id, '')) != '' THEN 1 ELSE 0 END) AS sayac_count,
        SUM(
          CASE
            WHEN TRIM(COALESCE(sayac_id, '')) != ''
             AND instr(lower(trim(coalesce(sayac_markasi, ''))), 'polimeter') > 0
            THEN 1 ELSE 0
          END
        ) AS polimeter_count
      FROM sayac
      WHERE bina_id = ?
    `
      )
      .get(bina_id) as { sayac_kayit: number; sayac_count: number; polimeter_count: number };

    writeAudit(request, auth.user, {
      action: "update",
      entity: "sayac",
      entityId: bina_id,
      summary: `${building?.value || "Bina"} için ${rows.length} sayaç satırı kaydedildi`,
      before: oldRows,
      after: rows.map((row: Record<string, unknown>) => ({
        birim_no: row.birim_no,
        sayac_id: row.sayac_id,
        abone_no: row.abone_no,
        kapi_no: row.kapi_no,
      })),
      metadata: { saved: rows.length, ...sayacStats },
    });

    return NextResponse.json({
      success: true,
      saved: rows.length,
      sayac_kayit: sayacStats.sayac_kayit,
      sayac_count: sayacStats.sayac_count,
      polimeter_count: sayacStats.polimeter_count || 0,
      bildirimler: yeniBildirimler,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
