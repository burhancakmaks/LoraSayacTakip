import json
import sqlite3
import urllib.request


db = sqlite3.connect(r"data\binalar.db")
print("excel", db.execute(
    "select count(1), sum(bina_id is not null), count(distinct bina_id) from excel_abonelikler"
).fetchone())
building_id = db.execute(
    "select bina_id from excel_abonelikler where abone_no = ?", ("461132",)
).fetchone()[0]
print("sample_building_id", building_id)

buildings = json.load(urllib.request.urlopen("http://127.0.0.1:3000/api/binalar", timeout=90))
building = next(item for item in buildings if item["id"] == building_id)
print("map_summary", building["value"], building["excel_kayit_sayisi"], building["excel_abone_sayisi"], building["excel_sayac_sayisi"])

meters = json.load(urllib.request.urlopen(
    f"http://127.0.0.1:3000/api/sayac?bina_id={building_id}", timeout=30
))
print("meter_summary", len(meters), meters[0]["excel_satir_no"], meters[0]["excel_durum"], meters[0]["adres"])
print("page_status", urllib.request.urlopen(
    f"http://127.0.0.1:3000/abonelikler/bina/{building_id}", timeout=60
).status)
