import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureMeterCoordTables } from "./schema.mjs";
import { resolveMarka } from "./plan.mjs";
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
      ) VALUES (?, 0, ?, 0, ?, 1, ?, '', '', datetime('now'))
    `);
    const fillEmptyBilgi = db.prepare(`
      UPDATE bina_bilgi
      SET daire_sayisi = CASE WHEN COALESCE(daire_sayisi,0) = 0 THEN ? ELSE daire_sayisi END,
          toplam_bagımsız_bolum = CASE
            WHEN COALESCE(toplam_bagımsız_bolum,0) = 0 THEN ?
            ELSE toplam_bagımsız_bolum
          END,
          has_zemin = CASE
            WHEN COALESCE(kat_sayisi,0) = 0 AND COALESCE(has_zemin,0) = 0 THEN 1
            ELSE has_zemin
          END,
          ada_parsel = CASE WHEN TRIM(COALESCE(ada_parsel,'')) = '' THEN ? ELSE ada_parsel END,
          updated_at = datetime('now')
      WHERE bina_id = ?
    `);
    const fillBlok = db.prepare(`
      UPDATE sayac
      SET blok_no = CASE WHEN TRIM(COALESCE(blok_no,'')) = '' THEN ? ELSE blok_no END,
          updated_at = datetime('now')
      WHERE bina_id = ? AND TRIM(COALESCE(blok_no,'')) = ''
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
    let bilgiFilled = 0;
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
      const marka = resolveMarka(row);
      const abone = String(row.abone_no || row.installation_number || "").trim();
      const tesisat = String(row.installation_number || "").trim();
      const sozlesme = String(row.agreement_number || "").trim();
      const kaynak = String(row.kaynak || "meter-coord-import");
      if (row.action === "insert") {
        const birim = nextBirim(row.bina_id);
        insertSayac.run(
          row.bina_id,
          birim,
          row.meter_number,
          marka,
          abone,
          tesisat,
          sozlesme,
          kaynak
        );
        inserted++;
      } else if (row.action === "update") {
        updateSayac.run(
          marka,
          abone,
          tesisat,
          sozlesme,
          kaynak,
          row.existing_id
        );
        updated++;
      }
    }

    const adaByBina = meta.adaByBinaId instanceof Map ? meta.adaByBinaId : new Map();
    const binaNameById = new Map(
      db.prepare("SELECT id, value FROM binalar").all().map((r) => [r.id, String(r.value || "").trim()])
    );
    const plannedBinaIds = [
      ...new Set(
        plan.sayacPlan
          .filter((r) => r.action !== "skip" && r.bina_id)
          .map((r) => r.bina_id)
      ),
    ];
    const unitCounts = uniqueUnitsByBina(db, plannedBinaIds);

    for (const binaId of plannedBinaIds) {
      const n = unitCounts.get(binaId) || 0;
      if (n <= 0) continue;
      const ada = adaByBina.get(binaId) || "";
      const exists = db.prepare("SELECT daire_sayisi, toplam_bagımsız_bolum, has_zemin, kat_sayisi, ada_parsel FROM bina_bilgi WHERE bina_id=?").get(binaId);
      if (!exists) {
        insertBilgi.run(binaId, n, n, ada);
        bilgiCreated++;
      } else {
        const needDaire = !(Number(exists.daire_sayisi) > 0);
        const needToplam = !(Number(exists.toplam_bagımsız_bolum) > 0);
        const needZemin = Number(exists.kat_sayisi) === 0 && Number(exists.has_zemin) !== 1;
        const needAda = !String(exists.ada_parsel || "").trim() && !!ada;
        if (needDaire || needToplam || needZemin || needAda) {
          fillEmptyBilgi.run(n, n, ada, binaId);
          bilgiFilled++;
        }
      }
      const blok = binaNameById.get(binaId) || "";
      if (blok) fillBlok.run(blok, binaId);
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
      bilgiFilled,
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

function uniqueUnitsByBina(db, binaIds) {
  const out = new Map();
  if (!binaIds.length) return out;
  const chunk = 400;
  for (let i = 0; i < binaIds.length; i += chunk) {
    const ids = binaIds.slice(i, i + chunk);
    const rows = db
      .prepare(
        `SELECT bina_id,
                COUNT(DISTINCT CASE WHEN TRIM(COALESCE(abone_no,'')) != '' THEN TRIM(abone_no) END) AS abones,
                SUM(CASE WHEN TRIM(COALESCE(sayac_id,'')) != '' THEN 1 ELSE 0 END) AS meters
         FROM sayac
         WHERE bina_id IN (${ids.map(() => "?").join(",")})
         GROUP BY bina_id`
      )
      .all(...ids);
    for (const row of rows) {
      const n = Number(row.abones) > 0 ? Number(row.abones) : Number(row.meters) || 0;
      out.set(row.bina_id, n);
    }
  }
  return out;
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
