"""Fill mapped real-building metadata from the eight MASKI workbooks."""

import json
import re
import shutil
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "binalar.db"
APPROX_LAYER = "MASKI_EXCEL_ABONELIK_YAKLASIK"
SOURCES = (
    "37-50 ADA E BLOK 72 ADET MASKİ ABONELİK (1).XLS",
    "37-50 ADA A-B BLOK 344 ADETMASKİ ABONELİK.xlsx",
    "ŞİRE PAZARI MASKİ ABONELİKLERİ.xlsx",
    "53 ADA MASKİ ABONELERİ.xlsx",
    "49 ADA 301 ADET  MASKİ ABONELİK (1).xlsx",
    "41-134   341 ADET  maski abonelik.xlsx",
    "46 ADA KONUT MASKİ ABONELERİ.xlsx",
    "4.ETAP TS SAYAÇ NO.xlsx",
)


def clean(value):
    return " ".join(str(value or "").split())


def unique_join(values):
    return ", ".join(dict.fromkeys(clean(value) for value in values if clean(value)))


def building_address(address):
    address = clean(address)
    # Apartment-specific suffixes are meter/unit data, not the building address.
    return re.sub(r",?\s*(?:DAİRE|DAIRE|D\.)\s*[:#-]?\s*\S+\s*$", "", address, flags=re.I).strip(" ,")


def main():
    backup = DB.with_name(f"binalar.before-excel-building-info-{datetime.now():%Y%m%d-%H%M%S}.db")
    shutil.copy2(DB, backup)

    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in SOURCES)
    groups = db.execute(
        f"""
        SELECT e.*
        FROM excel_abonelikler e
        JOIN binalar b ON b.id=e.bina_id
        WHERE e.kaynak_dosya IN ({placeholders})
          AND e.bina_id IS NOT NULL
          AND b.layer<>?
          AND TRIM(COALESCE(e.sayac_no,''))<>''
        ORDER BY e.bina_id,e.excel_satir_no
        """,
        (*SOURCES, APPROX_LAYER),
    ).fetchall()

    by_building = {}
    for row in groups:
        by_building.setdefault(row["bina_id"], []).append(row)

    db.execute("BEGIN IMMEDIATE")
    inserted = updated = 0
    try:
        for building_id, rows in by_building.items():
            adas = unique_join(row["ada"] for row in rows)
            blocks = unique_join(row["blok"] for row in rows)
            floors = {clean(row["kat"]) for row in rows if clean(row["kat"])}
            addresses = [building_address(row["adres"]) for row in rows if building_address(row["adres"])]
            address = Counter(addresses).most_common(1)[0][0] if addresses else ""
            total = len(rows)
            has_ground = int(any("ZEM" in floor.upper() for floor in floors))
            exists = db.execute("SELECT 1 FROM bina_bilgi WHERE bina_id=?", (building_id,)).fetchone()

            db.execute(
                """
                INSERT INTO bina_bilgi (
                  bina_id,kat_sayisi,daire_sayisi,ortak_alan_sayisi,
                  toplam_bagımsız_bolum,has_zemin,ada_parsel,sokak,dis_kapi_no
                ) VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(bina_id) DO UPDATE SET
                  kat_sayisi=CASE WHEN COALESCE(kat_sayisi,0)=0 THEN excluded.kat_sayisi ELSE kat_sayisi END,
                  daire_sayisi=CASE WHEN COALESCE(daire_sayisi,0)=0 THEN excluded.daire_sayisi ELSE daire_sayisi END,
                  toplam_bagımsız_bolum=CASE WHEN COALESCE(toplam_bagımsız_bolum,0)=0 THEN excluded.toplam_bagımsız_bolum ELSE toplam_bagımsız_bolum END,
                  has_zemin=MAX(COALESCE(has_zemin,0),excluded.has_zemin),
                  ada_parsel=CASE WHEN TRIM(COALESCE(ada_parsel,''))='' THEN excluded.ada_parsel ELSE ada_parsel END,
                  sokak=CASE WHEN TRIM(COALESCE(sokak,''))='' THEN excluded.sokak ELSE sokak END,
                  dis_kapi_no=CASE WHEN TRIM(COALESCE(dis_kapi_no,''))='' THEN excluded.dis_kapi_no ELSE dis_kapi_no END,
                  updated_at=datetime('now')
                """,
                (building_id, len(floors), total, 0, total, has_ground, adas, address, blocks),
            )
            db.execute(
                """UPDATE binalar SET
                abone_sayisi=MAX(COALESCE(abone_sayisi,0),?),
                aktif_abone_sayisi=MAX(COALESCE(aktif_abone_sayisi,0),?)
                WHERE id=?""",
                (total, total, building_id),
            )
            if exists:
                updated += 1
            else:
                inserted += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(json.dumps({
        "buildings": len(by_building),
        "meter_rows": len(groups),
        "inserted": inserted,
        "updated": updated,
        "backup": str(backup),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
