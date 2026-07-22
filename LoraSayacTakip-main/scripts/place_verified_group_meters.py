"""Place all workbook meters for verified source/block groups onto real buildings."""

import argparse
import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "binalar.db"

GROUP_TARGETS = {
    ("41-134   341 ADET  maski abonelik.xlsx", "A BLOK"): 1609,
    ("41-134   341 ADET  maski abonelik.xlsx", "B BLOK"): 1610,
    ("41-134   341 ADET  maski abonelik.xlsx", "C BLOK"): 1688,
    ("41-134   341 ADET  maski abonelik.xlsx", "D BLOK"): 1689,
    ("46 ADA KONUT MASKİ ABONELERİ.xlsx", "A BLOK"): 1107,
    ("46 ADA KONUT MASKİ ABONELERİ.xlsx", "B1 BLOK"): 1109,
    ("46 ADA KONUT MASKİ ABONELERİ.xlsx", "B2 BLOK"): 1110,
    ("46 ADA KONUT MASKİ ABONELERİ.xlsx", "C1 BLOK"): 1105,
    ("46 ADA KONUT MASKİ ABONELERİ.xlsx", "C2 BLOK"): 1106,
    ("53 ADA MASKİ ABONELERİ.xlsx", "A BLOK"): 1108,
    ("53 ADA MASKİ ABONELERİ.xlsx", "B BLOK"): 1754,
    ("ŞİRE PAZARI MASKİ ABONELİKLERİ.xlsx", "A BLOK"): 1935,
    ("ŞİRE PAZARI MASKİ ABONELİKLERİ.xlsx", "B BLOK"): 1938,
    ("ŞİRE PAZARI MASKİ ABONELİKLERİ.xlsx", "C BLOK"): 1936,
    ("ŞİRE PAZARI MASKİ ABONELİKLERİ.xlsx", "D BLOK"): 1937,
    ("4.ETAP TS SAYAÇ NO.xlsx", "DB-01"): 716,
    ("4.ETAP TS SAYAÇ NO.xlsx", "DB-02"): 717,
    ("4.ETAP TS SAYAÇ NO.xlsx", "DB-03"): 713,
    ("4.ETAP TS SAYAÇ NO.xlsx", "DB-04"): 718,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    summary = {"groups": 0, "rows": 0, "new_meters": 0, "existing_meters": 0, "buildings": set()}
    prepared = []
    for (source, block), building_id in GROUP_TARGETS.items():
        building = db.execute(
            "SELECT id,layer,value FROM binalar WHERE id=?", (building_id,)
        ).fetchone()
        if not building or building["layer"] == "MASKI_EXCEL_ABONELIK_YAKLASIK":
            raise RuntimeError(f"Gerçek bina hedefi geçersiz: {building_id}")
        rows = db.execute(
            """SELECT * FROM excel_abonelikler
            WHERE kaynak_dosya=? AND blok=? AND TRIM(sayac_no)<>'' ORDER BY excel_satir_no""",
            (source, block),
        ).fetchall()
        if not rows:
            continue
        summary["groups"] += 1
        summary["rows"] += len(rows)
        summary["buildings"].add(building_id)
        existing = {
            row["sayac_id"].strip(): row["id"]
            for row in db.execute("SELECT id,sayac_id FROM sayac WHERE bina_id=?", (building_id,))
            if row["sayac_id"].strip()
        }
        for row in rows:
            meter = row["sayac_no"].strip()
            is_new = meter not in existing
            summary["new_meters" if is_new else "existing_meters"] += 1
            prepared.append((building_id, row, is_new))
    summary["buildings"] = len(summary["buildings"])
    if not args.apply:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        db.close()
        return

    db.close()
    backup = DATABASE.with_name(f"binalar.before-verified-group-placement-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db")
    shutil.copy2(DATABASE, backup)
    db = sqlite3.connect(DATABASE, timeout=30)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN IMMEDIATE")
        next_units = {
            building_id: db.execute(
                "SELECT COALESCE(MAX(birim_no),0)+1 FROM sayac WHERE bina_id=?", (building_id,)
            ).fetchone()[0]
            for building_id in set(GROUP_TARGETS.values())
        }
        for building_id, row, is_new in prepared:
            db.execute(
                "UPDATE excel_abonelikler SET bina_id=?,updated_at=datetime('now') WHERE kayit_id=?",
                (building_id, row["kayit_id"]),
            )
            if is_new:
                db.execute(
                    """INSERT INTO sayac(
                      bina_id,birim_no,daire_no,blok_no,kat,kapi_no,oda_sayisi,
                      kullanilis_sekli,sayac_markasi,sayac_id,sicil_no,abone_no,updated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))""",
                    (
                        building_id, next_units[building_id], row["daire"], row["blok"],
                        row["kat"], row["daire"], "YOK", row["durum"] or "DAİRE", "",
                        row["sayac_no"], "", row["abone_no"],
                    ),
                )
                next_units[building_id] += 1
            else:
                db.execute(
                    """UPDATE sayac SET
                      blok_no=CASE WHEN TRIM(COALESCE(blok_no,''))='' THEN ? ELSE blok_no END,
                      kat=CASE WHEN TRIM(COALESCE(kat,''))='' THEN ? ELSE kat END,
                      kapi_no=CASE WHEN TRIM(COALESCE(kapi_no,''))='' THEN ? ELSE kapi_no END,
                      daire_no=CASE WHEN TRIM(COALESCE(daire_no,''))='' THEN ? ELSE daire_no END,
                      abone_no=CASE WHEN TRIM(COALESCE(abone_no,''))='' THEN ? ELSE abone_no END,
                      updated_at=datetime('now') WHERE bina_id=? AND sayac_id=?""",
                    (row["blok"], row["kat"], row["daire"], row["daire"], row["abone_no"], building_id, row["sayac_no"]),
                )
        for building_id in set(GROUP_TARGETS.values()):
            counts = db.execute(
                "SELECT COUNT(*),COUNT(DISTINCT NULLIF(abone_no,'')) FROM excel_abonelikler WHERE bina_id=?",
                (building_id,),
            ).fetchone()
            db.execute(
                """UPDATE binalar SET abone_sayisi=MAX(COALESCE(abone_sayisi,0),?),
                aktif_abone_sayisi=MAX(COALESCE(aktif_abone_sayisi,0),?) WHERE id=?""",
                (counts[0], counts[1], building_id),
            )
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
