import hashlib
import json
import math
import re
import sqlite3
from pathlib import Path

import pandas as pd


SOURCE = Path(r"C:\Users\Surface\Downloads\MASKI_Abonelik_Yonetim_Sistemi_NİDANUR_SAHİN_.xlsx")
OUTPUT = Path("public/data/abonelikler.json")


def clean(value: object) -> str:
    if pd.isna(value):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def base_address(address: str) -> str:
    value = re.split(r",\s*Blok\b", address, maxsplit=1, flags=re.IGNORECASE)[0]
    value = re.sub(r"\bMah\.\b", "Mahallesi", value, flags=re.IGNORECASE)
    return value.strip(" ,")


def offset(center: list[float], key: str, index: int, count: int) -> list[float]:
    digest = int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16)
    angle = (2 * math.pi * index / max(count, 1)) + (digest % 360) * math.pi / 180
    ring = 1 + index // 16
    radius = 0.0005 * ring
    return [center[0] + math.sin(angle) * radius, center[1] + math.cos(angle) * radius]


def main() -> None:
    frame = pd.read_excel(SOURCE, sheet_name="Master Veri", dtype=object)
    frame = frame[frame["Abone No"].notna() | frame["Sayaç No"].notna()].copy()
    for column in frame.columns:
        frame[column] = frame[column].map(clean)

    database = sqlite3.connect("data/binalar.db")
    mahalle_centers = {
        clean(name).upper().replace(" MAH.", "").replace(" MAHALLESİ", ""): [lat, lng]
        for name, lat, lng in database.execute("select name, center_lat, center_lng from mahalleler")
    }
    grouped = []
    for (ada, blok, mahalle), rows in frame.groupby(
        ["Ada", "Blok", "Mahalle"], dropna=False, sort=True
    ):
        first_address = next((value for value in rows["Adres"] if value), "")
        grouped.append(
            {
                "ada": clean(ada),
                "blok": clean(blok),
                "mahalle": clean(mahalle),
                "adres": base_address(first_address),
                "aboneSayisi": int(rows["Abone No"].replace("", pd.NA).nunique(dropna=True)),
                "sayacSayisi": int(rows["Sayaç No"].replace("", pd.NA).nunique(dropna=True)),
                "kayitSayisi": int(len(rows)),
            }
        )

    address_groups: dict[str, list[dict]] = {}
    for item in grouped:
        address_groups.setdefault(item["adres"], []).append(item)

    fallback = {
        "HALFETTIN": [38.3567, 38.3372],
        "YENIHAMAM": [38.3498, 38.3230],
    }
    for address, items in address_groups.items():
        mahalle_key = clean(items[0]["mahalle"]).upper().replace(" MAH.", "").replace(" MAHALLESİ", "")
        center = mahalle_centers.get(mahalle_key)
        if not center:
            key = "YENIHAMAM" if "YENIHAMAM" in mahalle_key else "HALFETTIN"
            center = fallback[key]
        for index, item in enumerate(items):
            item["coordinates"] = offset(center, f'{item["ada"]}|{item["blok"]}', index, len(items))
            item["konumTuru"] = "Mahalle merkezi bazlı yaklaşık konum"

    payload = {
        "source": SOURCE.name,
        "generatedAt": pd.Timestamp.now(tz="Europe/Istanbul").isoformat(),
        "summary": {
            "kayitSayisi": int(len(frame)),
            "aboneSayisi": int(frame["Abone No"].replace("", pd.NA).nunique(dropna=True)),
            "sayacSayisi": int(frame["Sayaç No"].replace("", pd.NA).nunique(dropna=True)),
            "konumSayisi": len(grouped),
            "adresSayisi": len(address_groups),
            "konumNotu": "Adresler dış servise gönderilmeden yerel mahalle merkezleri çevresine dağıtıldı.",
        },
        "locations": grouped,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
