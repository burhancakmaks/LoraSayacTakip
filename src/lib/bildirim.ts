import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { SAYAC_DURUM, type SayacDurum } from "@/lib/sayac-durum";

export type BildirimTip = SayacDurum | "duzeltildi" | "ozet";

export interface Bildirim {
  id: number;
  tip: BildirimTip;
  baslik: string;
  mesaj: string;
  bina_id: number | null;
  birim_no: number | null;
  okundu: number;
  created_at: string;
}

export function getBildirimDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS bildirim (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tip TEXT NOT NULL,
      baslik TEXT NOT NULL,
      mesaj TEXT NOT NULL,
      bina_id INTEGER,
      birim_no INTEGER,
      okundu INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bildirim_created ON bildirim(created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bildirim_okundu ON bildirim(okundu)`);
  return db;
}

export function bildirimBaslik(tip: BildirimTip): string {
  if (tip === "duzeltildi") return "Sayaç düzeltildi";
  if (tip === "ozet") return "Sayaç sorun özeti";
  return SAYAC_DURUM[tip]?.etiket ?? "Sayaç bildirimi";
}

export function createBildirim(
  db: DatabaseSync,
  input: {
    tip: BildirimTip;
    baslik?: string;
    mesaj: string;
    bina_id?: number | null;
    birim_no?: number | null;
  }
) {
  const baslik = input.baslik ?? bildirimBaslik(input.tip);
  const result = db
    .prepare(
      `INSERT INTO bildirim (tip, baslik, mesaj, bina_id, birim_no) VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.tip, baslik, input.mesaj, input.bina_id ?? null, input.birim_no ?? null);

  return db.prepare(`SELECT * FROM bildirim WHERE id = ?`).get(result.lastInsertRowid) as Bildirim;
}

export function seedBildirimlerIfEmpty(db: DatabaseSync) {
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM bildirim`).get() as { c: number }).c;
  if (count > 0) return 0;

  const rows = db
    .prepare(
      `
      SELECT s.bina_id, s.birim_no, s.kapi_no, s.kullanilis_sekli, s.sayac_id,
             COALESCE(s.sayac_durum, 'gecerli') AS sayac_durum, b.value AS building_name
      FROM sayac s
      JOIN binalar b ON b.id = s.bina_id
      WHERE COALESCE(s.sayac_durum, 'gecerli') IN ('eksik', 'okunmadi', 'hatali')
      LIMIT 50
    `
    )
    .all() as Array<{
      bina_id: number;
      birim_no: number;
      kapi_no: string;
      kullanilis_sekli: string;
      sayac_id: string;
      sayac_durum: SayacDurum;
      building_name: string;
    }>;

  const insert = db.prepare(
    `INSERT INTO bildirim (tip, baslik, mesaj, bina_id, birim_no, okundu, created_at)
     VALUES (?, ?, ?, ?, ?, 1, datetime('now', '-' || ? || ' minutes'))`
  );

  let seeded = 0;
  rows.forEach((row, i) => {
    const konum = [row.kapi_no && `Daire ${row.kapi_no}`, row.kullanilis_sekli].filter(Boolean).join(" · ");
    const mesaj = `${row.building_name}${konum ? ` — ${konum}` : ""}`;
    insert.run(row.sayac_durum, bildirimBaslik(row.sayac_durum), mesaj, row.bina_id, row.birim_no, i);
    seeded++;
  });

  return seeded;
}
