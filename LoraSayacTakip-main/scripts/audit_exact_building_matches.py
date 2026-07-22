import json
import sqlite3


db = sqlite3.connect(r"data\binalar.db")
targets = ["46 ADA", "53 ADA", "ŞİRE", "DB-", "1262 ADA"]
for target in targets:
    print(f"\n--- {target} ---")
    for building_id, value, oda_id, coordinates in db.execute(
        "SELECT id, value, oda_id, coordinates FROM binalar WHERE UPPER(COALESCE(value,'')) LIKE ? ORDER BY value, id",
        (f"%{target}%",),
    ):
        polygons = json.loads(coordinates)
        points = [point for polygon in polygons for point in polygon]
        lat = sum(point[0] for point in points) / len(points)
        lng = sum(point[1] for point in points) / len(points)
        print(building_id, repr(value), oda_id, round(lat, 6), round(lng, 6))
