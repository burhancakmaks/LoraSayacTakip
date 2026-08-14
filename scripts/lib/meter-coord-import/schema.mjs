/**
 * Backward-compatible schema additions for meter-coordinate import.
 * Never DROP existing tables or columns.
 */
export function ensureMeterCoordTables(db) {
  db.exec(`PRAGMA foreign_keys = ON`);

  const sayacCols = new Set(db.prepare("PRAGMA table_info(sayac)").all().map((c) => c.name));
  const addSayac = [
    ["tesisat_no", "TEXT DEFAULT ''"],
    ["sozlesme_no", "TEXT DEFAULT ''"],
    ["kaynak", "TEXT DEFAULT ''"],
    ["kullanilis_sekli", "TEXT DEFAULT 'DAİRE'"],
    ["sayac_durum", "TEXT DEFAULT 'gecerli'"],
    ["updated_at", "TEXT DEFAULT (datetime('now'))"],
  ];
  for (const [name, spec] of addSayac) {
    if (!sayacCols.has(name)) {
      db.exec(`ALTER TABLE sayac ADD COLUMN ${name} ${spec}`);
    }
  }

  const bilgiCols = new Set(db.prepare("PRAGMA table_info(bina_bilgi)").all().map((c) => c.name));
  const addBilgi = [
    ["updated_at", "TEXT DEFAULT (datetime('now'))"],
    ["daire_sayisi", "INTEGER DEFAULT 0"],
    ["has_zemin", "INTEGER DEFAULT 0"],
    ["ada_parsel", "TEXT DEFAULT ''"],
    ["sokak", "TEXT DEFAULT ''"],
    ["dis_kapi_no", "TEXT DEFAULT ''"],
  ];
  for (const [name, spec] of addBilgi) {
    if (!bilgiCols.has(name)) {
      db.exec(`ALTER TABLE bina_bilgi ADD COLUMN ${name} ${spec}`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS lora_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dev_eui TEXT NOT NULL UNIQUE,
      bolge TEXT DEFAULT '',
      blok TEXT DEFAULT '',
      daire TEXT DEFAULT '',
      kat TEXT DEFAULT '',
      durum TEXT DEFAULT '',
      son_uplink TEXT DEFAULT '',
      kaydeden TEXT DEFAULT '',
      kayit_tarihi TEXT DEFAULT '',
      notlar TEXT DEFAULT '',
      bina_id INTEGER,
      sayac_id TEXT,
      source_file TEXT DEFAULT '',
      source_row INTEGER,
      source_hash TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lora_devices_blok ON lora_devices(blok, daire);
    CREATE INDEX IF NOT EXISTS idx_lora_devices_bina ON lora_devices(bina_id);
    CREATE INDEX IF NOT EXISTS idx_lora_devices_durum ON lora_devices(durum);
  `);
}
