import argparse
import json
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("block")
args = parser.parse_args()

db = sqlite3.connect(Path(__file__).resolve().parents[1] / "data" / "binalar.db")
db.row_factory = sqlite3.Row
rows = db.execute(
    """SELECT e.kaynak_dosya,e.excel_satir_no,e.ada,e.blok,e.adres,e.bina_id,
              b.value,i.dis_kapi_no
       FROM excel_abonelikler e
       LEFT JOIN binalar b ON b.id=e.bina_id
       LEFT JOIN bina_bilgi i ON i.bina_id=e.bina_id
       WHERE REPLACE(UPPER(TRIM(e.blok)),'-','')=REPLACE(UPPER(TRIM(?)),'-','')
       ORDER BY e.excel_satir_no""",
    (args.block,),
).fetchall()
print(json.dumps({
    "count": len(rows),
    "first": dict(rows[0]) if rows else None,
    "building_ids": sorted({row["bina_id"] for row in rows if row["bina_id"] is not None}),
}, ensure_ascii=False, indent=2))
db.close()
