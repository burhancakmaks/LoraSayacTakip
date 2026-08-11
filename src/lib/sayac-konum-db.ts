import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { SayacKonum } from "./sayac-konum";

export function ensureSayacKonumSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sayac_konum (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_number TEXT NOT NULL,
      meter_key TEXT NOT NULL,
      installation_number TEXT DEFAULT '',
      agreement_number TEXT DEFAULT '',
      meter_type TEXT DEFAULT '',
      easting REAL,
      northing REAL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      crs TEXT DEFAULT 'EPSG:5257',
      bina_id INTEGER,
      sayac_id_matched TEXT DEFAULT '',
      match_kaynak TEXT DEFAULT '',
      source_file TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(meter_key)
    );
    CREATE INDEX IF NOT EXISTS idx_sayac_konum_meter ON sayac_konum(meter_number);
    CREATE INDEX IF NOT EXISTS idx_sayac_konum_key ON sayac_konum(meter_key);
    CREATE INDEX IF NOT EXISTS idx_sayac_konum_bina ON sayac_konum(bina_id);
  `);
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN lat REAL`);
  } catch {}
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN lng REAL`);
  } catch {}
}

export function getSayacKonumDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  ensureSayacKonumSchema(db);
  return db;
}

export function listKonumByBina(db: DatabaseSync, binaId: number): SayacKonum[] {
  return db
    .prepare(
      `SELECT meter_number, meter_key, installation_number, agreement_number, meter_type,
              lat, lng, bina_id, sayac_id_matched, match_kaynak
       FROM sayac_konum WHERE bina_id = ?
       ORDER BY meter_type, meter_number`
    )
    .all(binaId) as SayacKonum[];
}

export function findKonumBySayacId(db: DatabaseSync, sayacId: string): SayacKonum | null {
  const key = String(sayacId ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
  if (!key) return null;
  return (
    (db
      .prepare(
        `SELECT meter_number, meter_key, installation_number, agreement_number, meter_type,
                lat, lng, bina_id, sayac_id_matched, match_kaynak
         FROM sayac_konum
         WHERE meter_key = ? OR sayac_id_matched = ?
         LIMIT 1`
      )
      .get(key, String(sayacId).trim()) as SayacKonum | undefined) ?? null
  );
}
