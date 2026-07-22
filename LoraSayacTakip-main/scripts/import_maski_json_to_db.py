import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


SOURCE = Path("data/maski-abonelikler.json")
DATABASE = Path("data/binalar.db")


def main() -> None:
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    metadata = payload["metadata"]
    records = payload["records"]
    backup = DATABASE.with_name(f"binalar.before-json-import-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db")
    shutil.copy2(DATABASE, backup)

    connection = sqlite3.connect(DATABASE, timeout=30)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS excel_import_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_file TEXT NOT NULL,
            source_sha256 TEXT NOT NULL UNIQUE,
            generated_at TEXT NOT NULL,
            imported_at TEXT NOT NULL DEFAULT (datetime('now')),
            total_rows INTEGER NOT NULL,
            valid_rows INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS excel_abonelikler (
            kayit_id TEXT PRIMARY KEY,
            batch_id INTEGER NOT NULL,
            excel_satir_no INTEGER NOT NULL,
            ada TEXT NOT NULL DEFAULT '',
            blok TEXT NOT NULL DEFAULT '',
            kat TEXT NOT NULL DEFAULT '',
            daire TEXT NOT NULL DEFAULT '',
            ad_soyad TEXT NOT NULL DEFAULT '',
            abone_no TEXT NOT NULL DEFAULT '',
            sayac_no TEXT NOT NULL DEFAULT '',
            adres TEXT NOT NULL DEFAULT '',
            mahalle TEXT NOT NULL DEFAULT '',
            kaynak_dosya TEXT NOT NULL DEFAULT '',
            durum TEXT NOT NULL DEFAULT '',
            kaynak_json TEXT NOT NULL,
            bina_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_excel_abone_no ON excel_abonelikler(abone_no);
        CREATE INDEX IF NOT EXISTS idx_excel_sayac_no ON excel_abonelikler(sayac_no);
        CREATE INDEX IF NOT EXISTS idx_excel_ada_blok ON excel_abonelikler(ada, blok);
        CREATE INDEX IF NOT EXISTS idx_excel_mahalle ON excel_abonelikler(mahalle);
        CREATE INDEX IF NOT EXISTS idx_excel_bina_id ON excel_abonelikler(bina_id);
        CREATE INDEX IF NOT EXISTS idx_binalar_layer_value ON binalar(layer, value);
    """)

    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute(
            """
            INSERT INTO excel_import_batches (
                source_file, source_sha256, generated_at, total_rows, valid_rows
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(source_sha256) DO UPDATE SET
                source_file=excluded.source_file,
                generated_at=excluded.generated_at,
                total_rows=excluded.total_rows,
                valid_rows=excluded.valid_rows,
                imported_at=datetime('now')
            """,
            (
                metadata["sourceFile"], metadata["sourceSha256"], metadata["generatedAt"],
                payload["summary"]["masterSatirSayisi"], payload["summary"]["gecerliKayitSayisi"],
            ),
        )
        batch_id = connection.execute(
            "SELECT id FROM excel_import_batches WHERE source_sha256 = ?",
            (metadata["sourceSha256"],),
        ).fetchone()[0]
        connection.execute("DELETE FROM excel_abonelikler WHERE batch_id = ?", (batch_id,))

        statement = """
            INSERT INTO excel_abonelikler (
                kayit_id, batch_id, excel_satir_no, ada, blok, kat, daire,
                ad_soyad, abone_no, sayac_no, adres, mahalle, kaynak_dosya,
                durum, kaynak_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        connection.executemany(statement, [
            (
                record["kayit_id"], batch_id, record["excel_satir_no"], record["ada"],
                record["blok"], record["kat"], record["daire"], record["ad_soyad"],
                record["abone_no"], record["sayac_no"], record["adres"], record["mahalle"],
                record["kaynak_dosya"], record["durum"],
                json.dumps(record["kaynak"], ensure_ascii=False),
            )
            for record in records
        ])
        connection.execute("""
            UPDATE excel_abonelikler AS e
            SET bina_id = (
                SELECT b.id FROM binalar AS b
                WHERE b.layer = 'MASKI_EXCEL_ABONELIK_YAKLASIK'
                  AND b.value = 'MASKİ ' || e.ada || ' · ' || REPLACE(e.blok, '  ', ' ')
                LIMIT 1
            )
            WHERE EXISTS (
                SELECT 1 FROM binalar AS b
                WHERE b.layer = 'MASKI_EXCEL_ABONELIK_YAKLASIK'
                  AND b.value = 'MASKİ ' || e.ada || ' · ' || REPLACE(e.blok, '  ', ' ')
            )
        """)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    print(json.dumps({
        "backup": str(backup),
        "batchId": batch_id,
        "importedRows": len(records),
        "sourceSha256": metadata["sourceSha256"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
