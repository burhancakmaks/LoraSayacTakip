import type { DatabaseSync } from "node:sqlite";
import { normBlok } from "./sayac-blok-resolver";
import { parseWorkbookRows } from "./sayac-excel-parsers";

export const TEMPLATE_SHEET_NAME = "Sayaç Aktarım";

export const TEMPLATE_HEADERS = [
  "ADA/PARSEL",
  "BLOK",
  "KAT",
  "BAĞIMSIZ BÖLÜM KAPI NO",
  "NİTELİK",
  "UZAKTAN OKUMA SAYAÇ NO",
  "ABONE NO",
  "SİCİL NO",
] as const;

export type SayacDurum = "gecerli" | "okunmadi" | "eksik" | "hatali";

export interface ParsedSayacRow {
  rowNum: number;
  adaParsel: string;
  blok: string;
  kat: string;
  kapiNo: string;
  nitelik: string;
  sayacRaw: string;
  sayacId: string;
  aboneNo: string;
  sicilNo: string;
  durum: SayacDurum;
  binaId: number | null;
}

export interface ImportValidationError {
  row: number;
  column?: string;
  message: string;
}

export interface ImportValidationResult {
  valid: boolean;
  fatal: boolean;
  errors: ImportValidationError[];
  skipped: ImportValidationError[];
  rows: ParsedSayacRow[];
  importableRows: ParsedSayacRow[];
  stats: {
    total: number;
    importable: number;
    skipped: number;
    gecerli: number;
    okunmadi: number;
    eksik: number;
    hatali: number;
    mapped: number;
    unmapped: number;
  };
  preview: ParsedSayacRow[];
  format?: string;
  hint?: string;
  parsedTotal?: number;
}

export interface ImportApplyStats {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped_protected: number;
  skipped_duplicate_global: number;
  bina_bilgi_created: number;
  bina_bilgi_expanded: number;
}

function extractDigits(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

export function classifySayac(raw: unknown): SayacDurum {
  const s = String(raw ?? "").trim();
  if (!s) return "eksik";
  if (/OKUNMADI|OKUNAMADI|TAKILAMADI|TAKILMADI|SAYA[CÇ]\s*YOK|SAYAC\s*TAKIL/i.test(s)) return "okunmadi";
  if (s === "-" || /^YOK$/i.test(s) || /^-+$/.test(s)) return "eksik";
  const digits = extractDigits(s);
  if (digits.length >= 6 && digits.length <= 10) return "gecerli";
  return "hatali";
}

export function parseSayacCell(raw: unknown): { sayacId: string; durum: SayacDurum } | null {
  const durum = classifySayac(raw);
  if (durum === "hatali") return null;
  const s = String(raw ?? "").trim();
  if (durum === "okunmadi") return { sayacId: "OKUNMADI", durum };
  if (durum === "eksik") return { sayacId: "", durum };
  return { sayacId: s, durum: "gecerli" };
}

export function validateSayacImport(buffer: Buffer, db: DatabaseSync, filename = ""): ImportValidationResult {
  const fatalErrors: ImportValidationError[] = [];
  const skipped: ImportValidationError[] = [];

  const emptyResult = (errors: ImportValidationError[], hint?: string): ImportValidationResult => ({
    valid: false,
    fatal: true,
    errors,
    skipped: [],
    rows: [],
    importableRows: [],
    stats: {
      total: 0,
      importable: 0,
      skipped: 0,
      gecerli: 0,
      okunmadi: 0,
      eksik: 0,
      hatali: 0,
      mapped: 0,
      unmapped: 0,
    },
    preview: [],
    format: "none",
    hint,
    parsedTotal: 0,
  });

  let parsedRows: ParsedSayacRow[] = [];
  let format = "unknown";

  try {
    const result = parseWorkbookRows(buffer, db, filename);
    parsedRows = result.rows;
    format = result.format;
  } catch (error: unknown) {
    return emptyResult([
      { row: 0, message: error instanceof Error ? error.message : "Excel dosyası okunamadı." },
    ]);
  }

  if (!parsedRows.length) {
    return emptyResult(
      [
        {
          row: 0,
          message:
            "Dosyadan satır okunamadı. MASKİ abonelik Excel'i veya resmi şablonu kullanın (BLOK, KAPI NO, SAYAÇ NO sütunları).",
        },
      ],
      "Bu dosya sayaç listesi formatında değil. 49 ADA, 5. ETAP, ŞİRE gibi MASKİ abonelik dosyası yükleyin."
    );
  }

  const allRows: ParsedSayacRow[] = [];
  const importableRows: ParsedSayacRow[] = [];
  const sayacKeys = new Map<string, number>();
  const unitKeys = new Map<string, number>();

  for (const row of parsedRows) {
    const rowNum = row.rowNum;

    if (!row.binaId) {
      skipped.push({
        row: rowNum,
        column: "BLOK",
        message: `Bina eşleşmesi yok (ADA: "${row.adaParsel || "—"}", BLOK: "${row.blok}") — satır atlandı.`,
      });
      continue;
    }

    if (row.aboneNo && !/^\d{4,12}$/.test(row.aboneNo.replace(/\s/g, ""))) {
      skipped.push({ row: rowNum, column: "ABONE NO", message: `Geçersiz abone no — satır atlandı.` });
      continue;
    }

    if (row.durum === "gecerli") {
      const key = extractDigits(row.sayacId);
      const prevRow = sayacKeys.get(key);
      if (prevRow !== undefined) {
        skipped.push({
          row: rowNum,
          column: "UZAKTAN OKUMA SAYAÇ NO",
          message: `Tekrarlayan sayaç (${key}), önce satır ${prevRow} — atlandı.`,
        });
        continue;
      }
      sayacKeys.set(key, rowNum);
    }

    const unitKey = `${row.binaId}|${normBlok(row.blok)}|${row.kapiNo}|${row.nitelik}`;
    const prevUnit = unitKeys.get(unitKey);
    if (prevUnit !== undefined) {
      skipped.push({ row: rowNum, message: `Tekrarlayan birim, önce satır ${prevUnit} — atlandı.` });
      continue;
    }
    unitKeys.set(unitKey, rowNum);

    allRows.push(row);
    importableRows.push(row);
  }

  const stats = {
    total: parsedRows.length,
    importable: importableRows.length,
    skipped: skipped.length,
    gecerli: importableRows.filter((x) => x.durum === "gecerli").length,
    okunmadi: importableRows.filter((x) => x.durum === "okunmadi").length,
    eksik: importableRows.filter((x) => x.durum === "eksik").length,
    hatali: importableRows.filter((x) => x.durum === "hatali").length,
    mapped: importableRows.length,
    unmapped: parsedRows.length - importableRows.length - skipped.filter((s) => s.message.includes("Bina")).length,
  };

  const valid = importableRows.length > 0;

  let hint: string | undefined;
  if (!valid) {
    if (parsedRows.length === 0) {
      hint =
        "Dosya okunamadı. MASKİ abonelik Excel'i (49 ADA, 5. ETAP, ŞİRE vb.) veya resmi şablonu kullanın.";
    } else {
      const binaSkip = skipped.filter((s) => s.message.includes("Bina eşleşmesi")).length;
      if (binaSkip === skipped.length && skipped.length > 0) {
        hint =
          "Satırlar okundu ancak hiçbiri haritadaki binalarla eşleşmedi. Dosya adında ADA bilgisi olsun (ör. 49 ADA, 5. ETAP). Yanlış dosya türü de olabilir.";
      } else {
        hint = "Geçerli satır kalmadı. Sarı tablodaki atlanan satırları kontrol edin.";
      }
    }
    if (!skipped.length && !fatalErrors.length) {
      fatalErrors.push({ row: 0, message: hint ?? "Aktarılacak geçerli satır bulunamadı." });
    }
  }

  return {
    valid,
    fatal: fatalErrors.length > 0 && importableRows.length === 0 && parsedRows.length === 0,
    errors: fatalErrors,
    skipped: skipped.slice(0, 200),
    rows: allRows,
    importableRows,
    stats,
    preview: allRows.slice(0, 20),
    format,
    hint,
    parsedTotal: parsedRows.length,
  };
}

function normSayacKey(v: string): string {
  return extractDigits(v);
}

export function applySayacImport(db: DatabaseSync, rows: ParsedSayacRow[]): ImportApplyStats {
  const stats: ImportApplyStats = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped_protected: 0,
    skipped_duplicate_global: 0,
    bina_bilgi_created: 0,
    bina_bilgi_expanded: 0,
  };

  const find = db.prepare(
    `SELECT birim_no, sayac_id FROM sayac
     WHERE bina_id = ? AND kapi_no = ? AND blok_no = ? AND kullanilis_sekli = ?
     LIMIT 1`
  );
  const findBySayac = db.prepare(
    `SELECT birim_no, sayac_id FROM sayac
     WHERE bina_id = ? AND REPLACE(REPLACE(REPLACE(UPPER(TRIM(sayac_id)),'2025-',''),'-',''),' ','') = ?
     LIMIT 1`
  );
  const findGlobalSayac = db.prepare(
    `SELECT bina_id, birim_no, sayac_id FROM sayac
     WHERE TRIM(COALESCE(sayac_id,'')) != ''
       AND REPLACE(REPLACE(REPLACE(UPPER(TRIM(sayac_id)),'2025-',''),'-',''),' ','') = ?
     LIMIT 1`
  );
  const nextBirim = db.prepare(`SELECT COALESCE(MAX(birim_no),0)+1 n FROM sayac WHERE bina_id=?`);
  const insert = db.prepare(
    `INSERT INTO sayac (bina_id, birim_no, blok_no, kat, kapi_no, kullanilis_sekli, sayac_id, abone_no, sicil_no, sayac_durum, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(bina_id, birim_no) DO UPDATE SET
       sayac_id = excluded.sayac_id,
       sayac_durum = excluded.sayac_durum,
       blok_no = excluded.blok_no,
       kat = excluded.kat,
       kapi_no = excluded.kapi_no,
       kullanilis_sekli = excluded.kullanilis_sekli,
       abone_no = excluded.abone_no,
       sicil_no = excluded.sicil_no,
       updated_at = datetime('now')`
  );

  db.exec("BEGIN");
  try {
    for (const rec of rows) {
      if (!rec.binaId) continue;

      const sayacKey = normSayacKey(rec.sayacId);
      let existing = find.get(rec.binaId, rec.kapiNo, rec.blok, rec.nitelik) as
        | { birim_no: number; sayac_id: string }
        | undefined;

      if (!existing && sayacKey) {
        existing = findBySayac.get(rec.binaId, sayacKey) as { birim_no: number; sayac_id: string } | undefined;
      }

      if (!existing && sayacKey && rec.durum === "gecerli") {
        const global = findGlobalSayac.get(sayacKey) as
          | { bina_id: number; birim_no: number; sayac_id: string }
          | undefined;
        if (global) {
          if (global.bina_id !== rec.binaId) {
            stats.skipped_duplicate_global++;
            continue;
          }
          existing = global;
        }
      }

      if (existing && rec.durum !== "gecerli" && classifySayac(existing.sayac_id) === "gecerli") {
        stats.skipped_protected++;
        continue;
      }

      const birimNo =
        existing?.birim_no ?? (nextBirim.get(rec.binaId) as { n: number }).n;
      const prev = existing?.sayac_id ?? "";

      insert.run(
        rec.binaId,
        birimNo,
        rec.blok,
        rec.kat,
        rec.kapiNo,
        rec.nitelik,
        rec.sayacId,
        rec.aboneNo || null,
        rec.sicilNo || null,
        rec.durum
      );

      if (!existing) stats.inserted++;
      else if (String(prev).trim() !== String(rec.sayacId).trim()) stats.updated++;
      else stats.unchanged++;
    }

    ensureBinaBilgiForSayacli(db, stats);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return stats;
}

function ensureBinaBilgiForSayacli(db: DatabaseSync, stats: ImportApplyStats) {
  const targets = db
    .prepare(
      `SELECT s.bina_id, COUNT(*) AS sayac_sayisi, MAX(bb.ada_parsel) AS ada_parsel
       FROM sayac s
       LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
       WHERE TRIM(COALESCE(s.sayac_id, '')) != ''
       GROUP BY s.bina_id
       HAVING NOT EXISTS (SELECT 1 FROM bina_bilgi bi WHERE bi.bina_id = s.bina_id)`
    )
    .all() as { bina_id: number; sayac_sayisi: number; ada_parsel: string | null }[];

  const insertBilgi = db.prepare(
    `INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
      has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
     VALUES (?, 0, ?, 0, ?, 0, ?, '', '', datetime('now'))`
  );

  for (const row of targets) {
    const n = row.sayac_sayisi || 1;
    insertBilgi.run(row.bina_id, n, n, row.ada_parsel || "");
    stats.bina_bilgi_created++;
  }

  const expand = db
    .prepare(
      `SELECT bb.bina_id, bb.toplam_bagımsız_bolum AS kapasite, COUNT(s.id) AS sayac_sayisi
       FROM bina_bilgi bb
       JOIN sayac s ON s.bina_id = bb.bina_id AND TRIM(COALESCE(s.sayac_id, '')) != ''
       GROUP BY bb.bina_id
       HAVING sayac_sayisi > kapasite`
    )
    .all() as { bina_id: number; kapasite: number; sayac_sayisi: number }[];

  const upd = db.prepare(
    `UPDATE bina_bilgi SET daire_sayisi = ?, toplam_bagımsız_bolum = ?, updated_at = datetime('now') WHERE bina_id = ?`
  );

  for (const row of expand) {
    const cap = Math.max(row.kapasite || 0, row.sayac_sayisi);
    upd.run(cap, cap, row.bina_id);
    stats.bina_bilgi_expanded++;
  }
}
