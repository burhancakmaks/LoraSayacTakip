import json
import sqlite3
from pathlib import Path

db = sqlite3.connect(Path(__file__).resolve().parents[1] / "data" / "binalar.db")
db.row_factory = sqlite3.Row

buildings = db.execute(
    "SELECT id,value,layer,aktif_abone_sayisi FROM binalar "
    "WHERE UPPER(COALESCE(value,'')) LIKE '%YUVAM%'"
).fetchall()
excel = db.execute(
    """SELECT bina_id,ada,blok,adres,mahalle,kaynak_dosya,COUNT(*) kayit
       FROM excel_abonelikler
       WHERE UPPER(COALESCE(adres,'')) LIKE '%YUVAM%'
          OR UPPER(COALESCE(blok,'')) LIKE '%YUVAM%'
       GROUP BY bina_id,ada,blok,adres,mahalle,kaynak_dosya
       LIMIT 50"""
).fetchall()

details = []
for building in buildings:
    building_id = building["id"]
    info = db.execute("SELECT * FROM bina_bilgi WHERE bina_id=?", (building_id,)).fetchone()
    meter_count = db.execute(
        "SELECT COUNT(*) FROM sayac WHERE bina_id=? AND TRIM(COALESCE(sayac_id,''))<>''",
        (building_id,),
    ).fetchone()[0]
    excel_count = db.execute(
        "SELECT COUNT(*) FROM excel_abonelikler WHERE bina_id=?", (building_id,)
    ).fetchone()[0]
    details.append({
        "building": dict(building),
        "bina_bilgi": dict(info) if info else None,
        "meter_count": meter_count,
        "excel_count": excel_count,
    })

print(json.dumps({"details": details, "excel_name_matches": [dict(row) for row in excel]}, ensure_ascii=False, indent=2))
db.close()
