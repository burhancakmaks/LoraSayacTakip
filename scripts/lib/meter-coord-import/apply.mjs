import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureMeterCoordTables } from "./schema.mjs";
import { MARKA_FROM_VALUE } from "./plan.mjs";
import { stampIso } from "./common.mjs";

export function createDbBackup(dbPath, backupDir, label = "meter-coord") {
  mkdirSync(backupDir, { recursive: true });
  const stamp = stampIso();
  const backupPath = join(backupDir, `binalar.before-${label}-${stamp}.db`);
  copyFileSync(dbPath, backupPath);
  const size = statSync(backupPath).size;
  const sourceSize = statSync(dbPath).size;
  if (!existsSync(backupPath) || size < 1 || size !== sourceSize) {
    throw new Error(`Yedek doğrulanamadı: ${backupPath} size=${size} source=${sourceSize}`);
  }
  return { backupPath, size, stamp };
}

export function applyPlan(db, plan, meta) {
  ensureMeterCoordTables(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const maxBirim = new Map(
      db.prepare("SELECT bina_id, MAX(birim_no) m FROM sayac GROUP BY bina_id").all().map((r) => [r.bina_id, r.m || 0])
    );
    const nextBirim = (binaId) => {
      const n = (maxBirim.get(binaId) || 0) + 1;
      maxBirim.set(binaId, n);
      return n;
    };

    const insertSayac = db.prepare(`
      INSERT INTO sayac (
        bina_id, birim_no, sayac_id, sayac_markasi, abone_no, sicil_no,
        tesisat_no, sozlesme_no, kaynak, kullanilis_sekli, sayac_durum, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'DAİRE', 'gecerli', datetime('now'))
    `);
    const updateSayac = db.prepare(`
      UPDATE sayac
      SET sayac_markasi = CASE WHEN TRIM(COALESCE(sayac_markasi,'')) = '' THEN ? ELSE sayac_markasi END,
          abone_no = CASE WHEN TRIM(COALESCE(abone_no,'')) = '' THEN ? ELSE abone_no END,
          tesisat_no = CASE WHEN TRIM(COALESCE(tesisat_no,'')) = '' THEN ? ELSE tesisat_no END,
          sozlesme_no = CASE WHEN TRIM(COALESCE(sozlesme_no,'')) = '' THEN ? ELSE sozlesme_no END,
          kaynak = CASE WHEN TRIM(COALESCE(kaynak,'')) = '' THEN ? ELSE kaynak END,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    const insertBilgi = db.prepare(`
      INSERT INTO bina_bilgi (
        bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
        has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
      ) VALUES (?, 0, ?, 0, ?, 1, '', '', '', datetime('now'))
    `);
    const bumpBilgi = db.prepare(`
      UPDATE bina_bilgi
      SET daire_sayisi = CASE WHEN daire_sayisi < ? THEN ? ELSE daire_sayisi END,
          toplam_bagımsız_bolum = CASE WHEN toplam_bagımsız_bolum < ? THEN ? ELSE toplam_bagımsız_bolum END,
          has_zemin = CASE WHEN kat_sayisi = 0 AND has_zemin = 0 THEN 1 ELSE has_zemin END,
          updated_at = datetime('now')
      WHERE bina_id = ?
    `);
    const insertDevice = db.prepare(`
      INSERT INTO lora_devices (
        dev_eui, bolge, blok, daire, kat, durum, son_uplink, kaydeden, kayit_tarihi, notlar,
        bina_id, sayac_id, source_file, source_row, source_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, datetime('now'))
    `);
    const updateDevice = db.prepare(`
      UPDATE lora_devices
      SET bolge=?, blok=?, daire=?, kat=?, durum=?, son_uplink=?, kaydeden=?, kayit_tarihi=?, notlar=?,
          source_file=?, source_row=?, source_hash=?, updated_at=datetime('now')
      WHERE id=?
    `);

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let bilgiCreated = 0;
    let deviceInserted = 0;
    let deviceUpdated = 0;
    let deviceUnchanged = 0;

    for (const row of plan.sayacPlan) {
      if (row.action === "skip") {
        skipped++;
        continue;
      }
      if (row.action === "unchanged") {
        unchanged++;
        continue;
      }
      const marka = MARKA_FROM_VALUE[row.value] || "";
      if (row.action === "insert") {
        const birim = nextBirim(row.bina_id);
        insertSayac.run(
          row.bina_id,
          birim,
          row.meter_number,
          marka,
          row.installation_number || "",
          row.installation_number || "",
          row.agreement_number || "",
          "meter-coord-import"
        );
        inserted++;
      } else if (row.action === "update") {
        updateSayac.run(
          marka,
          row.installation_number || "",
          row.installation_number || "",
          row.agreement_number || "",
          "meter-coord-import",
          row.existing_id
        );
        updated++;
      }
    }

    const meterCounts = db
      .prepare(
        `SELECT bina_id,
                SUM(CASE WHEN TRIM(COALESCE(sayac_id,'')) != '' THEN 1 ELSE 0 END) AS sayac_count,
                MAX(birim_no) AS max_birim
         FROM sayac
         GROUP BY bina_id`
      )
      .all();
    const countByBina = new Map(
      meterCounts.map((r) => [r.bina_id, Math.max(Number(r.sayac_count) || 0, Number(r.max_birim) || 0)])
    );

    for (const binaId of plan.binaBilgiCreate) {
      const exists = db.prepare("SELECT 1 FROM bina_bilgi WHERE bina_id=?").get(binaId);
      if (exists) continue;
      const n = countByBina.get(binaId) || 0;
      insertBilgi.run(binaId, n, n);
      bilgiCreated++;
    }
    for (const [binaId, n] of countByBina) {
      if (n <= 0) continue;
      bumpBilgi.run(n, n, n, n, binaId);
    }

    const sourceFile = basenameSafe(meta.csvName);
    for (const row of plan.devicePlan) {
      if (row.action === "skip") continue;
      if (row.action === "unchanged") {
        deviceUnchanged++;
        continue;
      }
      if (row.action === "insert") {
        insertDevice.run(
          row.deveui,
          row.bolge,
          row.blok,
          row.daire,
          row.kat,
          row.durum,
          row.son_uplink,
          row.kaydeden,
          row.kayit_tarihi,
          row.notlar,
          sourceFile,
          row.source_row,
          meta.csvHash
        );
        deviceInserted++;
      } else if (row.action === "update") {
        updateDevice.run(
          row.bolge,
          row.blok,
          row.daire,
          row.kat,
          row.durum,
          row.son_uplink,
          row.kaydeden,
          row.kayit_tarihi,
          row.notlar,
          sourceFile,
          row.source_row,
          meta.csvHash,
          row.existing_id
        );
        deviceUpdated++;
      }
    }

    db.exec("COMMIT");
    return {
      inserted,
      updated,
      unchanged,
      skipped,
      bilgiCreated,
      deviceInserted,
      deviceUpdated,
      deviceUnchanged,
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function basenameSafe(name) {
  if (!name) return "";
  return String(name).split(/[/\\]/).pop();
}

export function verifyAfterApply(db, plan, applied) {
  const mismatches = [];
  const sayacTotal = db.prepare("SELECT COUNT(*) c FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!=''").get().c;
  const devices = db.prepare("SELECT COUNT(*) c FROM lora_devices").get().c;
  if (applied.inserted !== plan.dbSummary.sayacInsert) {
    mismatches.push(`insert ${applied.inserted} != plan ${plan.dbSummary.sayacInsert}`);
  }
  if (applied.updated !== plan.dbSummary.sayacUpdate) {
    mismatches.push(`update ${applied.updated} != plan ${plan.dbSummary.sayacUpdate}`);
  }
  if (applied.deviceInserted !== plan.dbSummary.deviceInsert) {
    mismatches.push(`device insert ${applied.deviceInserted} != plan ${plan.dbSummary.deviceInsert}`);
  }
  const dupMeters = db
    .prepare(
      `SELECT TRIM(sayac_id) sid, COUNT(DISTINCT bina_id) n
       FROM sayac
       WHERE TRIM(COALESCE(sayac_id,'')) != '' AND TRIM(sayac_id) != 'OKUNMADI'
       GROUP BY TRIM(sayac_id)
       HAVING n > 1`
    )
    .all();
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const fk = db.prepare("PRAGMA foreign_key_check").all();
  return {
    sayacTotal,
    devices,
    mismatches,
    newDuplicateMeters: dupMeters.length,
    integrity: integrity.integrity_check || integrity["integrity_check"],
    foreignKeyViolations: fk.length,
    ok: mismatches.length === 0 && fk.length === 0 && (integrity.integrity_check === "ok" || integrity["integrity_check"] === "ok"),
  };
}
