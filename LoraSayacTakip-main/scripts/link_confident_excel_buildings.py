"""Link only confidently identified Excel ada/blok groups to real KML buildings.

This migration is deliberately additive/update-only: it never deletes rows and
creates an audit record for every explicit match. A timestamped DB backup is
created before the transaction starts.
"""

from __future__ import annotations

import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "binalar.db"

MATCHES = {
    ("41-134 Ada", "A BLOK"): 1609,
    ("41-134 Ada", "B BLOK"): 1610,
    ("41-134 Ada", "C BLOK"): 1688,
    ("41-134 Ada", "D BLOK"): 1689,
    ("46 Ada", "A BLOK"): 1107,
    ("46 Ada", "B1 BLOK"): 1109,
    ("46 Ada", "B2 BLOK"): 1110,
    ("46 Ada", "C1 BLOK"): 1105,
    ("46 Ada", "C2 BLOK"): 1106,
    ("46 Ada", "D BLOK"): 1939,
    ("53 Ada", "A BLOK"): 1108,
    ("53 Ada", "B BLOK"): 1754,
    ("Şire Pazarı", "A BLOK"): 1935,
    ("Şire Pazarı", "B BLOK"): 1938,
    ("Şire Pazarı", "C BLOK"): 1936,
    ("Şire Pazarı", "D BLOK"): 1937,
    ("4. Etap", "DB-01"): 716,
    ("4. Etap", "DB-02"): 717,
    ("4. Etap", "DB-03"): 713,
    ("4. Etap", "DB-04"): 718,
}


def address_parts(address: str) -> tuple[str, str]:
    door = ""
    match = re.search(r"(?:NO|NO:|NO\s)\s*([0-9]+[A-ZÇĞİÖŞÜ/-]*)", address, re.I)
    if match:
        door = match.group(1)
    street = ""
    match = re.search(r"([^,]+?(?:SOKAK|SOKAĞI|CADDE|CADDESİ|BULVAR|BULVARI))", address, re.I)
    if match:
        street = match.group(1).strip()
    return street, door


stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
backup = DB_PATH.with_name(f"binalar.before-confident-link-{stamp}.db")
shutil.copy2(DB_PATH, backup)

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row
db.execute("PRAGMA foreign_keys=ON")
db.execute(
    """
    CREATE TABLE IF NOT EXISTS excel_building_matches (
      ada TEXT NOT NULL,
      blok TEXT NOT NULL,
      bina_id INTEGER NOT NULL,
      match_method TEXT NOT NULL,
      confidence TEXT NOT NULL,
      linked_row_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (ada, blok)
    )
    """
)

info_columns = {row[1] for row in db.execute("PRAGMA table_info(bina_bilgi)")}
total_column = next((c for c in info_columns if c.startswith("toplam_bag")), None)
linked = 0

with db:
    for (ada, blok), bina_id in MATCHES.items():
        exists = db.execute("SELECT 1 FROM binalar WHERE id=?", (bina_id,)).fetchone()
        if not exists:
            raise RuntimeError(f"Gerçek bina bulunamadı: {bina_id}")

        count = db.execute(
            "SELECT COUNT(*) FROM excel_abonelikler WHERE ada=? AND blok=?", (ada, blok)
        ).fetchone()[0]
        if not count:
            continue

        db.execute(
            "UPDATE excel_abonelikler SET bina_id=?, updated_at=datetime('now') WHERE ada=? AND blok=?",
            (bina_id, ada, blok),
        )
        linked += count
        db.execute(
            """
            INSERT INTO excel_building_matches
              (ada, blok, bina_id, match_method, confidence, linked_row_count, updated_at)
            VALUES (?, ?, ?, 'explicit_ada_blok_kml', 'high', ?, datetime('now'))
            ON CONFLICT(ada, blok) DO UPDATE SET
              bina_id=excluded.bina_id, match_method=excluded.match_method,
              confidence=excluded.confidence, linked_row_count=excluded.linked_row_count,
              updated_at=datetime('now')
            """,
            (ada, blok, bina_id, count),
        )

        rows = db.execute(
            "SELECT kat, daire, adres FROM excel_abonelikler WHERE ada=? AND blok=?",
            (ada, blok),
        ).fetchall()
        floors = {r["kat"].strip() for r in rows if r["kat"].strip()}
        flats = {r["daire"].strip() for r in rows if r["daire"].strip()}
        has_ground = int(any("ZEM" in floor.upper() for floor in floors))
        first_address = next((r["adres"] for r in rows if r["adres"].strip()), "")
        street, door = address_parts(first_address)

        columns = ["bina_id", "kat_sayisi", "daire_sayisi", "ortak_alan_sayisi", "has_zemin", "ada_parsel", "sokak", "dis_kapi_no"]
        values = [bina_id, len(floors), len(flats), 0, has_ground, ada, street, door]
        if total_column:
            columns.insert(4, total_column)
            values.insert(4, count)
        placeholders = ",".join("?" for _ in columns)
        updates = []
        for column in columns[1:]:
            if column in {"ada_parsel", "sokak", "dis_kapi_no"}:
                updates.append(f"{column}=CASE WHEN COALESCE({column},'')='' THEN excluded.{column} ELSE {column} END")
            else:
                updates.append(f"{column}=CASE WHEN COALESCE({column},0)=0 THEN excluded.{column} ELSE {column} END")
        db.execute(
            f"INSERT INTO bina_bilgi ({','.join(columns)}) VALUES ({placeholders}) "
            f"ON CONFLICT(bina_id) DO UPDATE SET {','.join(updates)}, updated_at=datetime('now')",
            values,
        )
        db.execute(
            """
            UPDATE binalar SET
              abone_sayisi=MAX(COALESCE(abone_sayisi,0), ?),
              aktif_abone_sayisi=MAX(COALESCE(aktif_abone_sayisi,0), ?)
            WHERE id=?
            """,
            (count, count, bina_id),
        )

db.close()
print(f"Yedek: {backup}")
print(f"Güvenle gerçek binalara bağlanan Excel satırı: {linked}")
print(f"Eşleştirilen gerçek bina: {len(MATCHES)}")
