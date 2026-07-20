import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

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
        abone_no
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
  try {
    const body = await request.json();
    const { bina_id, rows } = body;

    if (!bina_id || !Array.isArray(rows)) {
      return NextResponse.json({ error: "bina_id ve rows gerekli" }, { status: 400 });
    }

    const db = getDb();
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
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
        updated_at = datetime('now')
    `);

    for (const row of rows) {
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
        row.abone_no || ""
      );
    }

    return NextResponse.json({ success: true, saved: rows.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
