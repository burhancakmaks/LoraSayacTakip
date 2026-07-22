"""Fill blank local meter numbers from confidently matching Excel records."""

import sqlite3
from pathlib import Path


DATABASE = Path(__file__).resolve().parents[1] / "data" / "binalar.db"

with sqlite3.connect(DATABASE) as db:
    count = db.execute(
        """
        SELECT COUNT(DISTINCT s.id) FROM sayac s
        JOIN excel_abonelikler e ON e.bina_id = s.bina_id AND e.sayac_no <> ''
          AND ((s.abone_no <> '' AND e.abone_no = s.abone_no)
            OR (s.kapi_no <> '' AND e.daire = s.kapi_no))
        WHERE COALESCE(s.sayac_id, '') = ''
        """
    ).fetchone()[0]

    db.execute(
        """
        WITH candidates AS (
          SELECT s.id AS sayac_row_id, e.sayac_no,
            ROW_NUMBER() OVER (
              PARTITION BY s.id
              ORDER BY CASE
                WHEN s.abone_no <> '' AND e.abone_no = s.abone_no THEN 0 ELSE 1
              END, e.excel_satir_no
            ) AS priority
          FROM sayac s
          JOIN excel_abonelikler e ON e.bina_id = s.bina_id AND e.sayac_no <> ''
            AND ((s.abone_no <> '' AND e.abone_no = s.abone_no)
              OR (s.kapi_no <> '' AND e.daire = s.kapi_no))
          WHERE COALESCE(s.sayac_id, '') = ''
        )
        UPDATE sayac
        SET sayac_id = (
              SELECT c.sayac_no FROM candidates c
              WHERE c.sayac_row_id = sayac.id AND c.priority = 1
            ),
            updated_at = datetime('now')
        WHERE COALESCE(sayac_id, '') = ''
          AND id IN (SELECT sayac_row_id FROM candidates WHERE priority = 1)
        """
    )

print(f"Excel'den doldurulan sayaç numarası: {count}")
