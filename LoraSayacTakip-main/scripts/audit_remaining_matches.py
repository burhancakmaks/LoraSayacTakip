import sqlite3
from pathlib import Path

db = sqlite3.connect(Path(__file__).resolve().parents[1] / "data" / "binalar.db")
print("TABLES", db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall())
for table in ("aboneler", "abone", "sayac", "bina_bilgi"):
    try:
        print("SCHEMA", table, db.execute(f"PRAGMA table_info({table})").fetchall(), db.execute(f"SELECT COUNT(*) FROM {table}").fetchone())
    except sqlite3.Error as error:
        print("SCHEMA", table, error)
patterns = ["49 ADA", "DC-", "GB-", "37 ADA", "50 ADA", "A9", "BLOK"]
for pattern in patterns:
    print(f"\n--- {pattern} ---")
    rows = db.execute(
        """SELECT id,value,oda_id,layer,abone_sayisi,aktif_abone_sayisi
           FROM binalar WHERE UPPER(COALESCE(value,'')) LIKE ?
           ORDER BY value,id LIMIT 300""",
        (f"%{pattern.upper()}%",),
    )
    for row in rows:
        print(row)
