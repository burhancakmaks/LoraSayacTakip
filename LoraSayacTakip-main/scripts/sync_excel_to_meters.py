"""Synchronize every available Excel subscription field into meter rows.

Source-empty values never erase a manually entered value. The operation is
additive/upsert-only and keeps non-Excel meter rows intact.
"""

import sqlite3
from collections import defaultdict
from pathlib import Path


DATABASE = Path(__file__).resolve().parents[1] / "data" / "binalar.db"


with sqlite3.connect(DATABASE) as db:
    db.row_factory = sqlite3.Row
    groups: dict[int, list[sqlite3.Row]] = defaultdict(list)
    for row in db.execute(
        """
        SELECT bina_id, blok, kat, daire, abone_no, sayac_no, durum
        FROM excel_abonelikler
        WHERE bina_id IS NOT NULL
        ORDER BY bina_id, excel_satir_no
        """
    ):
        groups[row["bina_id"]].append(row)

    upsert = db.cursor()
    synced = 0
    for building_id, rows in groups.items():
        for unit_number, row in enumerate(rows, start=1):
            usage = "ORTAK ALAN" if "ORTAK" in row["durum"].upper() or "DEPO" in row["blok"].upper() else "DAİRE"
            upsert.execute(
                """
                INSERT INTO sayac (
                  bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi,
                  kullanilis_sekli, sayac_markasi, sayac_id, sicil_no,
                  abone_no, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'YOK', ?, '', ?, '', ?, datetime('now'))
                ON CONFLICT(bina_id, birim_no) DO UPDATE SET
                  blok_no=CASE WHEN excluded.blok_no<>'' THEN excluded.blok_no ELSE sayac.blok_no END,
                  kat=CASE WHEN excluded.kat<>'' THEN excluded.kat ELSE sayac.kat END,
                  kapi_no=CASE WHEN excluded.kapi_no<>'' THEN excluded.kapi_no ELSE sayac.kapi_no END,
                  kullanilis_sekli=excluded.kullanilis_sekli,
                  sayac_id=CASE WHEN excluded.sayac_id<>'' THEN excluded.sayac_id ELSE sayac.sayac_id END,
                  abone_no=CASE WHEN excluded.abone_no<>'' THEN excluded.abone_no ELSE sayac.abone_no END,
                  updated_at=datetime('now')
                """,
                (
                    building_id,
                    unit_number,
                    row["blok"],
                    row["kat"],
                    row["daire"],
                    usage,
                    row["sayac_no"],
                    row["abone_no"],
                ),
            )
            synced += 1

    info_columns = [row[1] for row in db.execute("PRAGMA table_info(bina_bilgi)")]
    total_column = next((column for column in info_columns if column.startswith("toplam_bag")), None)
    if total_column:
        for building_id, rows in groups.items():
            db.execute(
                f'UPDATE bina_bilgi SET "{total_column}"=?, updated_at=datetime(\'now\') WHERE bina_id=?',
                (len(rows), building_id),
            )

print(f"Senkronize edilen Excel/sayaç satırı: {synced}")
print(f"Güncellenen bina: {len(groups)}")
