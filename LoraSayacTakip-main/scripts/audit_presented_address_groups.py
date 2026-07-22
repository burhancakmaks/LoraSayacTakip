import json
import sqlite3
from pathlib import Path

from assign_remaining_by_proximity import APPROX, DB, SOURCES

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
results = []
for source in SOURCES:
    groups = db.execute(
        """SELECT blok,COUNT(*) rows,COUNT(DISTINCT NULLIF(TRIM(sayac_no),'')) meters,
                  COUNT(DISTINCT bina_id) targets,MIN(bina_id) bina_id
           FROM excel_abonelikler
           WHERE kaynak_dosya=? AND TRIM(COALESCE(sayac_no,''))<>''
           GROUP BY blok ORDER BY blok""",
        (source,),
    ).fetchall()
    for group in groups:
        block = group["blok"]
        building_id = group["bina_id"]
        missing = db.execute(
            """SELECT COUNT(*) FROM excel_abonelikler e
               WHERE e.kaynak_dosya=? AND e.blok=? AND TRIM(COALESCE(e.sayac_no,''))<>''
                 AND NOT EXISTS (
                   SELECT 1 FROM sayac s
                   WHERE s.bina_id=e.bina_id AND TRIM(s.sayac_id)=TRIM(e.sayac_no)
                 )""",
            (source, block),
        ).fetchone()[0]
        building = db.execute(
            "SELECT value,layer FROM binalar WHERE id=?", (building_id,)
        ).fetchone()
        info = db.execute(
            "SELECT ada_parsel,sokak,dis_kapi_no FROM bina_bilgi WHERE bina_id=?",
            (building_id,),
        ).fetchone()
        results.append({
            "source": source,
            "block": block,
            "building_id": building_id,
            "building": building["value"] if building else None,
            "real_polygon": bool(building and building["layer"] != APPROX),
            "excel_meters": group["meters"],
            "missing_meters": missing,
            "green": missing == 0 and group["meters"] > 0,
            "building_info": dict(info) if info else None,
        })

summary = {
    "groups": len(results),
    "real_polygon_groups": sum(item["real_polygon"] for item in results),
    "green_groups": sum(item["green"] for item in results),
    "missing_meter_groups": sum(item["missing_meters"] > 0 for item in results),
    "groups_with_building_info": sum(item["building_info"] is not None for item in results),
    "groups_with_address": sum(bool((item["building_info"] or {}).get("sokak")) for item in results),
}
print(json.dumps({"summary": summary, "problems": [item for item in results if not item["real_polygon"] or not item["green"] or not item["building_info"]]}, ensure_ascii=False, indent=2))
db.close()
