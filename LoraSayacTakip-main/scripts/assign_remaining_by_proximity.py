"""Assign remaining workbook meter groups to nearest unused real polygons."""

import argparse
import json
import math
import re
import shutil
import sqlite3
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "binalar.db"
APPROX = "MASKI_EXCEL_ABONELIK_YAKLASIK"
SOURCES = {
    "37-50 ADA E BLOK 72 ADET MASKİ ABONELİK (1).XLS": "3750",
    "37-50 ADA A-B BLOK 344 ADETMASKİ ABONELİK.xlsx": "3750",
    "ŞİRE PAZARI MASKİ ABONELİKLERİ.xlsx": "SIRE",
    "53 ADA MASKİ ABONELERİ.xlsx": "53",
    "49 ADA 301 ADET  MASKİ ABONELİK (1).xlsx": "49",
    "41-134   341 ADET  maski abonelik.xlsx": "41134",
    "46 ADA KONUT MASKİ ABONELERİ.xlsx": "46",
    "4.ETAP TS SAYAÇ NO.xlsx": "4ETAP",
}

def norm(value):
    value = unicodedata.normalize("NFKD", str(value or "").upper())
    return "".join(c for c in value if not unicodedata.combining(c) and c.isalnum())

def centroid(raw):
    polygons = json.loads(raw)
    points = [point for polygon in polygons for point in polygon]
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)

def distance(a, b):
    return math.hypot(a[0] - b[0], (a[1] - b[1]) * math.cos(math.radians(a[0])))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    real = [
        {"id": r["id"], "center": centroid(r["coordinates"])}
        for r in db.execute("SELECT id,coordinates FROM binalar WHERE layer<>?", (APPROX,))
    ]
    approximate = [
        {"id": r["id"], "key": norm(r["value"]), "center": centroid(r["coordinates"])}
        for r in db.execute("SELECT id,value,coordinates FROM binalar WHERE layer=?", (APPROX,))
    ]
    used = {
        r[0] for r in db.execute("""SELECT DISTINCT s.bina_id FROM sayac s JOIN binalar b ON b.id=s.bina_id
        WHERE b.layer<>? AND TRIM(COALESCE(s.sayac_id,''))<>''""", (APPROX,))
    }
    groups = []
    for source, area in SOURCES.items():
        for block_row in db.execute(
            "SELECT blok,COUNT(*) count FROM excel_abonelikler WHERE kaynak_dosya=? AND TRIM(sayac_no)<>'' GROUP BY blok",
            (source,),
        ):
            block = block_row["blok"]
            rows = db.execute(
                "SELECT * FROM excel_abonelikler WHERE kaynak_dosya=? AND blok=? AND TRIM(sayac_no)<>'' ORDER BY excel_satir_no",
                (source, block),
            ).fetchall()
            targets = Counter(
                r["bina_id"] for r in rows
                if r["bina_id"] and db.execute("SELECT layer FROM binalar WHERE id=?", (r["bina_id"],)).fetchone()[0] != APPROX
            )
            if targets:
                target = targets.most_common(1)[0][0]
                method = "existing_group"
                center = next(item["center"] for item in real if item["id"] == target)
            else:
                block_key = norm(block).replace("BLOK", "")
                candidates = [item for item in approximate if area in item["key"] and block_key and block_key in item["key"]]
                if not candidates:
                    groups.append({"source": source, "block": block, "rows": rows, "target": None, "method": "no_approximate"})
                    continue
                approx = min(candidates, key=lambda item: len(item["key"]))
                available = [item for item in real if item["id"] not in used]
                nearest = min(available or real, key=lambda item: distance(approx["center"], item["center"]))
                target, center, method = nearest["id"], nearest["center"], "nearest_real_polygon"
                used.add(target)
            groups.append({"source": source, "block": block, "rows": rows, "target": target, "method": method, "center": center})

    summary = {
        "groups": len(groups), "assigned_groups": sum(g["target"] is not None for g in groups),
        "unassigned_groups": sum(g["target"] is None for g in groups),
        "meter_rows": sum(len(g["rows"]) for g in groups if g["target"] is not None),
        "real_buildings": len({g["target"] for g in groups if g["target"] is not None}),
        "proximity_groups": sum(g["method"] == "nearest_real_polygon" for g in groups),
    }
    if not args.apply:
        summary["unassigned"] = [f"{g['source']} / {g['block']}" for g in groups if g["target"] is None]
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        db.close()
        return

    db.close()
    backup = DB.with_name(f"binalar.before-proximity-placement-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db")
    shutil.copy2(DB, backup)
    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN IMMEDIATE")
        next_units = {}
        for group in groups:
            target = group["target"]
            if target is None:
                continue
            next_units.setdefault(target, db.execute("SELECT COALESCE(MAX(birim_no),0)+1 FROM sayac WHERE bina_id=?", (target,)).fetchone()[0])
            existing = {r[0] for r in db.execute("SELECT sayac_id FROM sayac WHERE bina_id=?", (target,))}
            for row in group["rows"]:
                db.execute("UPDATE excel_abonelikler SET bina_id=?,updated_at=datetime('now') WHERE kayit_id=?", (target, row["kayit_id"]))
                if row["sayac_no"] in existing:
                    continue
                db.execute(
                    """INSERT INTO sayac(bina_id,birim_no,daire_no,blok_no,kat,kapi_no,oda_sayisi,
                    kullanilis_sekli,sayac_markasi,sayac_id,sicil_no,abone_no,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))""",
                    (target,next_units[target],row["daire"],row["blok"],row["kat"],row["daire"],"YOK",row["durum"] or "DAİRE","",row["sayac_no"],"",row["abone_no"]),
                )
                next_units[target] += 1
                existing.add(row["sayac_no"])
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    summary["backup"] = str(backup)
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
