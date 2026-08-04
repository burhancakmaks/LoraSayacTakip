import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { requireRole, writeAudit } from "@/lib/auth";

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
  try {
    const { searchParams } = new URL(request.url);
    const bina_id = searchParams.get("bina_id");
    if (!bina_id) return NextResponse.json({ error: "bina_id gerekli" }, { status: 400 });

    const db = getDb();
    const row = db.prepare("SELECT * FROM bina_bilgi WHERE bina_id = ?").get(parseInt(bina_id)) as any;
    return NextResponse.json(row || null);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (auth.response) return auth.response;
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
    const before = db.prepare("SELECT * FROM bina_bilgi WHERE bina_id = ?").get(bina_id);

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

    const after = db.prepare("SELECT * FROM bina_bilgi WHERE bina_id = ?").get(bina_id);
    writeAudit(request, auth.user, {
      action: before ? "update" : "create",
      entity: "bina_bilgi",
      entityId: bina_id,
      summary: `Bina bilgileri ${before ? "güncellendi" : "oluşturuldu"}`,
      before,
      after,
    });

    return NextResponse.json({ success: true, toplam_bagımsız_bolum: toplam });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
