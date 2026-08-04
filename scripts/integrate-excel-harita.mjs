/**
 * Excel -> DB -> Harita tam entegrasyon (profesyonel tek komut).
 * Kullanim: node scripts/integrate-excel-harita.mjs [--apply]
 *
 * Adimlar:
 * 1) Yedek al
 * 2) MASKI arama indeksini yenile
 * 3) Excel -> DB otomatik sync
 * 4) Indeks-DB gap kapatma (eksik sayaclar)
 * 5) Sayacli binalar icin bina_bilgi (haritada yesil)
 * 6) Dogrulama raporu
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DB_PATH = join(ROOT, "data/binalar.db");
const apply = process.argv.includes("--apply");

function runNode(script, args = []) {
  const res = spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`${script} basarisiz:\n${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

function normSayac(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

function audit(db) {
  const maski = JSON.parse(readFileSync(join(ROOT, "data/maski-arama-index.json"), "utf8"));
  const dbSet = new Set(
    db
      .prepare(`SELECT sayac_id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
      .all()
      .map((r) => normSayac(r.sayac_id))
  );
  const excelMissing = (maski.records || []).filter((r) => {
    const k = normSayac(r.sayac_no);
    return k && !dbSet.has(k);
  });

  const green = db.prepare(`
    SELECT
      COUNT(DISTINCT s.bina_id) AS sayacli_bina,
      COUNT(DISTINCT CASE WHEN bb.bina_id IS NOT NULL THEN s.bina_id END) AS yesil_bina,
      COUNT(DISTINCT CASE WHEN bb.bina_id IS NULL THEN s.bina_id END) AS mavi_bina
    FROM sayac s
    LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
    WHERE TRIM(COALESCE(s.sayac_id,'')) != ''
  `).get();

  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '') AS numarali_sayac,
      (SELECT COUNT(DISTINCT REPLACE(REPLACE(REPLACE(UPPER(TRIM(sayac_id)),'2025-',''),'-',''),' ',''))
       FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '') AS benzersiz_sayac,
      (SELECT COUNT(*) FROM bina_bilgi) AS bina_bilgi_kayit
  `).get();

  const maviList = db
    .prepare(
      `
    SELECT b.id, b.value, COUNT(s.id) sc
    FROM sayac s
    JOIN binalar b ON b.id = s.bina_id
    LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
    WHERE TRIM(COALESCE(s.sayac_id,'')) != '' AND bb.bina_id IS NULL
    GROUP BY b.id
    ORDER BY sc DESC
  `
    )
    .all();

  return {
    excel_index_kayit: maski.total,
    excelde_var_dbde_yok: excelMissing.length,
    eksik_ornekler: excelMissing.slice(0, 5).map((r) => ({ kaynak: r.kaynak, sayac: r.sayac_no, blok: r.blok })),
    ...totals,
    ...green,
    mavi_bina_listesi: maviList,
    harita_durumu: excelMissing.length === 0 && green.mavi_bina === 0 ? "TAMAM" : "EKSİK",
  };
}

const report = { apply, steps: [] };

if (!existsSync(DB_PATH)) {
  console.error("binalar.db bulunamadi");
  process.exit(1);
}

if (apply) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(ROOT, `data/binalar.before-integrate-${stamp}.db`);
  copyFileSync(DB_PATH, backup);
  report.backup = backup;

  report.steps.push({ step: "maski_index", output: runNode("build-maski-arama-index.mjs").slice(0, 500) });
  report.steps.push({
    step: "excel_sync",
    output: JSON.parse(runNode("sayac-otomatik-sync.mjs", ["--force"])),
  });

  const gapOut = runNode("import-excel-gap.mjs", ["--apply"]);
  report.steps.push({ step: "excel_gap", output: gapOut.slice(0, 800) });

  // Ek yesil garantisi
  const db = new DatabaseSync(DB_PATH);
  const missingBilgi = db
    .prepare(
      `
    SELECT s.bina_id, COUNT(*) c
    FROM sayac s
    WHERE TRIM(COALESCE(s.sayac_id,'')) != ''
      AND NOT EXISTS (SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = s.bina_id)
    GROUP BY s.bina_id
  `
    )
    .all();
  if (missingBilgi.length) {
    const ins = db.prepare(`
      INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
        has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
      VALUES (?, 0, ?, 0, ?, 0, '', '', '', datetime('now'))
    `);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of missingBilgi) {
        ins.run(row.bina_id, row.c, row.c);
      }
      db.exec("COMMIT");
      report.steps.push({ step: "bina_bilgi_fix", created: missingBilgi.length });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

const db = new DatabaseSync(DB_PATH);
report.audit = audit(db);
report.ozet = {
  durum: report.audit.harita_durumu,
  numarali_sayac: report.audit.numarali_sayac,
  benzersiz_sayac: report.audit.benzersiz_sayac,
  sayacli_bina: report.audit.sayacli_bina,
  yesil_bina: report.audit.yesil_bina,
  mavi_bina: report.audit.mavi_bina,
  excel_eksik: report.audit.excelde_var_dbde_yok,
};

console.log(JSON.stringify(report, null, 2));

if (report.audit.harita_durumu !== "TAMAM") {
  process.exit(apply ? 2 : 0);
}
