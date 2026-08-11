import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { LoraCihaz } from "./lora-cihaz";

export function ensureLoraSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lora_cihaz (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deveui TEXT NOT NULL UNIQUE,
      bolge TEXT DEFAULT '',
      blok TEXT DEFAULT '',
      blok_canon TEXT DEFAULT '',
      daire TEXT DEFAULT '',
      kapi_no TEXT DEFAULT '',
      kat TEXT DEFAULT '',
      durum TEXT DEFAULT '',
      son_uplink TEXT DEFAULT '',
      kaydeden TEXT DEFAULT '',
      kayit_tarihi TEXT DEFAULT '',
      notlar TEXT DEFAULT '',
      bina_id INTEGER,
      match_kaynak TEXT DEFAULT '',
      source_file TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lora_bina ON lora_cihaz(bina_id);
    CREATE INDEX IF NOT EXISTS idx_lora_blok ON lora_cihaz(blok_canon);
    CREATE INDEX IF NOT EXISTS idx_lora_kapi ON lora_cihaz(bina_id, kapi_no);
    CREATE INDEX IF NOT EXISTS idx_lora_durum ON lora_cihaz(durum);
  `);
}

export function getLoraDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  ensureLoraSchema(db);
  return db;
}

export function listLoraByBina(db: DatabaseSync, binaId: number): LoraCihaz[] {
  return db
    .prepare(
      `SELECT id, deveui, bolge, blok, blok_canon, daire, kapi_no, kat, durum,
              son_uplink, kaydeden, kayit_tarihi, notlar, bina_id, match_kaynak
       FROM lora_cihaz
       WHERE bina_id = ?
       ORDER BY
         CASE WHEN kapi_no GLOB '[0-9]*' THEN CAST(kapi_no AS INTEGER) ELSE 9999 END,
         kapi_no, deveui`
    )
    .all(binaId) as LoraCihaz[];
}
