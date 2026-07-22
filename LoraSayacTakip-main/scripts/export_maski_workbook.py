import hashlib
import json
import math
from datetime import date, datetime
from pathlib import Path

import pandas as pd


SOURCE = Path(r"C:\Users\Surface\Desktop\MASKI_Abonelik_Yonetim_Sistemi_NİDANUR_SAHİN_.xlsx")
RAW_OUTPUT = Path("data/maski-workbook.json")
NORMALIZED_OUTPUT = Path("data/maski-abonelikler.json")

FIELD_MAP = {
    "Ada": "ada",
    "Blok": "blok",
    "Kat": "kat",
    "Daire": "daire",
    "Ad Soyad": "ad_soyad",
    "Abone No": "abone_no",
    "Sayaç No": "sayac_no",
    "Adres": "adres",
    "Mahalle": "mahalle",
    "Kaynak Dosya": "kaynak_dosya",
    "Durum": "durum",
}


def json_value(value):
    if value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value):
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):
        value = value.item()
    return value


def text(value) -> str:
    value = json_value(value)
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def main() -> None:
    source_bytes = SOURCE.read_bytes()
    book = pd.ExcelFile(SOURCE)
    raw_sheets = {}
    sheet_manifest = []

    for sheet_name in book.sheet_names:
        frame = pd.read_excel(SOURCE, sheet_name=sheet_name, header=None, dtype=object)
        matrix = [[json_value(cell) for cell in row] for row in frame.itertuples(index=False, name=None)]
        raw_sheets[sheet_name] = matrix
        non_empty = sum(cell is not None for row in matrix for cell in row)
        sheet_manifest.append({
            "name": sheet_name,
            "rows": len(matrix),
            "columns": len(matrix[0]) if matrix else 0,
            "nonEmptyCells": non_empty,
        })

    master = pd.read_excel(SOURCE, sheet_name="Master Veri", dtype=object)
    missing_columns = [column for column in FIELD_MAP if column not in master.columns]
    if missing_columns:
        raise RuntimeError(f"Master Veri sütunları eksik: {missing_columns}")

    records = []
    for row_index, row in master.iterrows():
        source_values = {column: json_value(row[column]) for column in FIELD_MAP}
        normalized = {target: text(row[source]) for source, target in FIELD_MAP.items()}
        normalized["excel_satir_no"] = int(row_index) + 2
        normalized["kayit_id"] = hashlib.sha256(
            f'{normalized["excel_satir_no"]}|{normalized["ada"]}|{normalized["blok"]}|{normalized["abone_no"]}|{normalized["sayac_no"]}'.encode("utf-8")
        ).hexdigest()[:20]
        normalized["kaynak"] = source_values
        records.append(normalized)

    valid_records = [record for record in records if record["abone_no"] or record["sayac_no"]]
    unique_subscribers = {record["abone_no"] for record in valid_records if record["abone_no"]}
    unique_meters = {record["sayac_no"] for record in valid_records if record["sayac_no"]}
    duplicate_subscribers = len([key for key in unique_subscribers if sum(r["abone_no"] == key for r in valid_records) > 1])
    duplicate_meters = len([key for key in unique_meters if sum(r["sayac_no"] == key for r in valid_records) > 1])

    summary = {
        "masterSatirSayisi": len(records),
        "gecerliKayitSayisi": len(valid_records),
        "benzersizAboneSayisi": len(unique_subscribers),
        "benzersizSayacSayisi": len(unique_meters),
        "mukerrerAboneNoSayisi": duplicate_subscribers,
        "mukerrerSayacNoSayisi": duplicate_meters,
        "eksikAboneNoSayisi": sum(not record["abone_no"] for record in records),
        "eksikSayacNoSayisi": sum(not record["sayac_no"] for record in records),
        "adaBolgeleri": sorted({record["ada"] for record in records if record["ada"]}),
        "mahalleler": sorted({record["mahalle"] for record in records if record["mahalle"]}),
    }

    metadata = {
        "sourceFile": SOURCE.name,
        "sourcePath": str(SOURCE),
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "generatedAt": datetime.now().astimezone().isoformat(),
        "sheetCount": len(book.sheet_names),
        "sheets": sheet_manifest,
    }

    RAW_OUTPUT.write_text(
        json.dumps({"metadata": metadata, "sheets": raw_sheets}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    NORMALIZED_OUTPUT.write_text(
        json.dumps({"metadata": metadata, "summary": summary, "records": records}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"metadata": metadata, "summary": summary}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
