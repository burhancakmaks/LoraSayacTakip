import hashlib
import json
import math
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


DATABASE = Path("data/binalar.db")
IMPORT_LAYER = "MASKI_EXCEL_ABONELIK_YAKLASIK"


def square(lat: float, lng: float, size: float = 0.00009) -> str:
    return json.dumps([[
        [lat - size, lng - size], [lat - size, lng + size],
        [lat + size, lng + size], [lat + size, lng - size],
        [lat - size, lng - size],
    ]])


def offset(lat: float, lng: float, key: str) -> tuple[float, float]:
    digest = int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16)
    angle = (digest % 360) * math.pi / 180
    radius = 0.001 + ((digest // 360) % 12) * 0.00016
    return lat + math.sin(angle) * radius, lng + math.cos(angle) * radius


def main() -> None:
    backup = DATABASE.with_name(f"binalar.before-additive-map-sync-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db")
    shutil.copy2(DATABASE, backup)
    db = sqlite3.connect(DATABASE, timeout=30)
    db.execute("BEGIN IMMEDIATE")
    try:
        groups = db.execute("""
            SELECT ada, blok, mahalle, COUNT(*) AS kayit,
                   COUNT(DISTINCT NULLIF(abone_no, '')) AS abone,
                   COUNT(DISTINCT NULLIF(sayac_no, '')) AS sayac,
                   COUNT(DISTINCT NULLIF(kat, '')) AS kat,
                   COUNT(DISTINCT NULLIF(daire, '')) AS daire
            FROM excel_abonelikler
            GROUP BY ada, blok, mahalle
            ORDER BY ada, blok, mahalle
        """).fetchall()
        centers = {
            name.upper().replace(" MAH.", "").replace(" MAHALLESİ", ""): (lat, lng)
            for name, lat, lng in db.execute("SELECT name, center_lat, center_lng FROM mahalleler")
        }
        created = 0
        linked = 0
        for ada, blok, mahalle, kayit, abone, sayac, kat, daire in groups:
            normalized_blok = " ".join((blok or "").split())
            value = f"MASKİ {ada} · {normalized_blok}"
            building = db.execute(
                "SELECT id FROM binalar WHERE layer = ? AND value = ? ORDER BY id LIMIT 1",
                (IMPORT_LAYER, value),
            ).fetchone()
            if building:
                building_id = building[0]
            else:
                mahalle_key = (mahalle or "").upper().replace(" MAH.", "").replace(" MAHALLESİ", "")
                center = centers.get(mahalle_key, (38.3552, 38.3302))
                lat, lng = offset(center[0], center[1], f"{ada}|{normalized_blok}|{mahalle}")
                cursor = db.execute("""
                    INSERT INTO binalar (
                        oda_id, kml_id, id_2, value, layer, abone_sayisi,
                        aktif_abone_sayisi, building_type_id, coordinates
                    ) VALUES (NULL, NULL, NULL, ?, ?, ?, ?, NULL, ?)
                """, (value, IMPORT_LAYER, abone, abone, square(lat, lng)))
                building_id = cursor.lastrowid
                db.execute("""
                    INSERT OR IGNORE INTO bina_bilgi (
                        bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi,
                        toplam_bagımsız_bolum, has_zemin, ada_parsel, sokak, dis_kapi_no
                    ) VALUES (?, ?, ?, 0, ?, 0, ?, '', '')
                """, (building_id, kat, daire, kayit, ada))
                created += 1

            result = db.execute("""
                UPDATE excel_abonelikler
                SET bina_id = ?, updated_at = datetime('now')
                WHERE ada = ? AND blok = ? AND mahalle = ?
                  AND (bina_id IS NULL OR bina_id != ?)
            """, (building_id, ada, blok, mahalle, building_id))
            linked += result.rowcount

            db.execute("""
                UPDATE binalar SET abone_sayisi = ?, aktif_abone_sayisi = ?
                WHERE id = ?
            """, (abone, abone, building_id))

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    print(json.dumps({"backup": str(backup), "groups": len(groups), "createdBuildings": created, "linkedRows": linked}, ensure_ascii=False))


if __name__ == "__main__":
    main()
