import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path


DATA_FILE = Path("public/data/abonelikler.json")
CACHE_FILE = Path("data/geocode-results.json")


def offset(center: list[float], key: str, index: int, count: int) -> list[float]:
    digest = int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16)
    angle = (2 * math.pi * index / max(count, 1)) + (digest % 360) * math.pi / 180
    ring = 1 + index // 16
    radius = 0.00016 * ring
    return [center[0] + math.sin(angle) * radius, center[1] + math.cos(angle) * radius]


def find_address(address: str) -> dict | None:
    queries = [
        f"{address}, Battalgazi, Malatya, Türkiye",
        f"{address}, Malatya, Türkiye",
    ]
    for query in queries:
        params = urllib.parse.urlencode({
                "q": query,
                "format": "jsonv2",
                "limit": 1,
                "countrycodes": "tr",
                "addressdetails": 1,
        })
        request = urllib.request.Request(
            f"https://nominatim.openstreetmap.org/search?{params}",
            headers={"User-Agent": "MASKI-Abonelik-Harita/1.0 (authorized local import)"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            rows = json.loads(response.read().decode("utf-8"))
        if rows:
            return {
                "lat": float(rows[0]["lat"]),
                "lng": float(rows[0]["lon"]),
                "display_name": rows[0].get("display_name", ""),
                "query": query,
            }
        time.sleep(1.1)
    return None


def main() -> None:
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    cache = json.loads(CACHE_FILE.read_text(encoding="utf-8")) if CACHE_FILE.exists() else {}
    groups: dict[str, list[dict]] = {}
    for item in payload["locations"]:
        groups.setdefault(item["adres"], []).append(item)

    osm_centers = {
        "HALFETTIN": [38.3540419, 38.3186297],
        "YENIHAMAM": [38.3509085, 38.3179753],
        "SIRE": [38.3524210, 38.3179089],
    }
    matched = 0
    for address, items in groups.items():
        if address not in cache:
            cache[address] = find_address(address)
            CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
            time.sleep(1.1)
        result = cache[address]
        if result:
            matched += 1
            center = [result["lat"], result["lng"]]
            location_type = "OpenStreetMap adres eşleşmesi"
        else:
            upper_address = address.upper().replace("İ", "I").replace("Ş", "S")
            center_key = "SIRE" if "SIRE" in upper_address else "YENIHAMAM" if "YENIHAMAM" in upper_address else "HALFETTIN"
            center = osm_centers[center_key]
            location_type = "OpenStreetMap mahalle/tesis merkezi (yaklaşık)"
        for index, item in enumerate(items):
            item["coordinates"] = offset(center, f'{item["ada"]}|{item["blok"]}', index, len(items))
            item["konumTuru"] = location_type

    payload["summary"]["geocodedAdresSayisi"] = matched
    payload["summary"]["adresSayisi"] = len(groups)
    payload["summary"]["konumNotu"] = "Kullanıcı izniyle OpenStreetMap üzerinden adres eşleştirmesi yapıldı."
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"addresses": len(groups), "matched": matched, "unmatched": len(groups) - matched}, ensure_ascii=False))


if __name__ == "__main__":
    main()
