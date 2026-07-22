import json
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

import pandas as pd


SOURCE = Path(r"C:\Users\Surface\Downloads\MASKI_Abonelik_Yonetim_Sistemi_NİDANUR_SAHİN_.xlsx")
DATABASE = Path("data/binalar.db")
LOCATION_DATA = Path("public/data/abonelikler.json")
IMPORT_LAYER = "MASKI_EXCEL_ABONELIK_YAKLASIK"


def clean(value: object) -> str:
    if pd.isna(value):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def square(lat: float, lng: float, size: float = 0.00009) -> str:
    polygon = [[
        [lat - size, lng - size],
        [lat - size, lng + size],
        [lat + size, lng + size],
        [lat + size, lng - size],
        [lat - size, lng - size],
    ]]
    return json.dumps(polygon, ensure_ascii=False)


def parse_street(address: str) -> str:
    match = re.search(r"Mah(?:\.|allesi)?\s+(.+?)(?:,|\s+(?:Dış Kapı )?No:)", address, re.IGNORECASE)
    return clean(match.group(1)) if match else ""


def parse_door(address: str) -> str:
    match = re.search(r"(?:Dış Kapı )?No:\s*([^,]+)", address, re.IGNORECASE)
    return clean(match.group(1)) if match else ""


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    if not LOCATION_DATA.exists():
        raise FileNotFoundError(LOCATION_DATA)

    backup = DATABASE.with_name(
        f"binalar.before-excel-import-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    )
    shutil.copy2(DATABASE, backup)

    frame = pd.read_excel(SOURCE, sheet_name="Master Veri", dtype=object)
    frame = frame[frame["Abone No"].notna() | frame["Sayaç No"].notna()].copy()
    for column in frame.columns:
        frame[column] = frame[column].map(clean)

    location_payload = json.loads(LOCATION_DATA.read_text(encoding="utf-8"))
    locations = {
        (item["ada"], item["blok"], item["mahalle"]): item
        for item in location_payload["locations"]
    }

    connection = sqlite3.connect(DATABASE, timeout=30)
    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute("BEGIN IMMEDIATE")
    try:
        old_ids = [
            row[0]
            for row in connection.execute("select id from binalar where layer = ?", (IMPORT_LAYER,))
        ]
        if old_ids:
            placeholders = ",".join("?" for _ in old_ids)
            connection.execute(f"delete from sayac where bina_id in ({placeholders})", old_ids)
            connection.execute(f"delete from bina_bilgi where bina_id in ({placeholders})", old_ids)
            connection.execute(f"delete from binalar where id in ({placeholders})", old_ids)

        building_count = 0
        meter_count = 0
        for (ada, blok, mahalle), rows in frame.groupby(
            ["Ada", "Blok", "Mahalle"], dropna=False, sort=True
        ):
            key = (clean(ada), clean(blok), clean(mahalle))
            location = locations.get(key)
            if not location:
                raise RuntimeError(f"Konum grubu bulunamadı: {key}")

            lat, lng = location["coordinates"]
            subscribers = rows["Abone No"].replace("", pd.NA).nunique(dropna=True)
            meters = rows["Sayaç No"].replace("", pd.NA).nunique(dropna=True)
            value = f"MASKİ {key[0]} · {key[1]}"
            cursor = connection.execute(
                """
                insert into binalar (
                    oda_id, kml_id, id_2, value, layer, abone_sayisi,
                    aktif_abone_sayisi, building_type_id, coordinates
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (None, None, None, value, IMPORT_LAYER, subscribers, subscribers, None, square(lat, lng)),
            )
            building_id = cursor.lastrowid
            building_count += 1

            address = clean(next((item for item in rows["Adres"] if item), ""))
            floors = {clean(item) for item in rows["Kat"] if clean(item)}
            apartments = {clean(item) for item in rows["Daire"] if clean(item)}
            connection.execute(
                """
                insert into bina_bilgi (
                    bina_id, kat_sayisi, daire_per_kat, ortak_alan_sayisi,
                    toplam_bagımsız_bolum, daire_sayisi, has_zemin,
                    ada_parsel, sokak, dis_kapi_no, updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                """,
                (
                    building_id,
                    len(floors),
                    round(len(apartments) / max(len(floors), 1)),
                    sum(1 for item in apartments if not re.search(r"\d", item)),
                    len(rows),
                    len(apartments),
                    int(any("ZEMİN" in floor.upper() or "ZEMIN" in floor.upper() for floor in floors)),
                    key[0],
                    parse_street(address),
                    parse_door(address),
                ),
            )

            for unit_number, (_, row) in enumerate(rows.iterrows(), start=1):
                connection.execute(
                    """
                    insert into sayac (
                        bina_id, birim_no, daire_no, blok_no, kat, kapi_no,
                        oda_sayisi, kullanilis_sekli, sayac_markasi, sayac_id,
                        sicil_no, abone_no, updated_at
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    """,
                    (
                        building_id,
                        unit_number,
                        clean(row["Daire"]),
                        key[1],
                        clean(row["Kat"]),
                        clean(row["Daire"]),
                        "YOK",
                        "DAİRE",
                        "",
                        clean(row["Sayaç No"]),
                        "",
                        clean(row["Abone No"]),
                    ),
                )
                meter_count += 1

        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    print(json.dumps({
        "backup": str(backup),
        "buildings": building_count,
        "meter_rows": meter_count,
        "layer": IMPORT_LAYER,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
