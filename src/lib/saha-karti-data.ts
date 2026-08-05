import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ensureAuthSchema } from "@/lib/auth";
import { SAYAC_DURUM, classifySayacDurum } from "@/lib/sayac-durum";

export interface SahaKartiMeter {
  birim_no: number;
  blok_no: string;
  kat: string;
  kapi_no: string;
  oda_sayisi: string;
  kullanilis_sekli: string;
  sayac_markasi: string;
  sayac_id: string;
  sicil_no: string;
  abone_no: string;
  sayac_durum: string;
  durum_etiket: string;
  updated_at: string | null;
}

export interface SahaKartiRezervAbone {
  abone_no: string;
  sayac_no: string;
  tarife_turu: string;
  tarife_sinif: string;
  building_uavt: string;
}

export interface SahaKartiAuditEntry {
  created_at: string;
  user_email: string;
  action: string;
  summary: string;
}

export interface SahaKartiPayload {
  exported_at: string;
  bina_id: number;
  building_name: string;
  oda_id: number | null;
  layer: string | null;
  building_info: {
    kat_sayisi: number;
    daire_sayisi: number;
    ortak_alan_sayisi: number;
    toplam_bagimsiz_bolum: number;
    has_zemin: boolean;
    ada_parsel: string;
    sokak: string;
    dis_kapi_no: string;
  } | null;
  tariff: {
    tarife_sinif: string;
    tarife_etiket: string;
    tarife_turu: string;
    abone_sayisi: number;
    building_uavt: string;
  } | null;
  meters: SahaKartiMeter[];
  rezerv_abonelikler: SahaKartiRezervAbone[];
  islem_gecmisi: SahaKartiAuditEntry[];
  filter: {
    abone_no: string | null;
    sayac_id: string | null;
  };
}

function normDigits(value: string) {
  return value.trim().replace(/^2025-/i, "").replace(/\D/g, "");
}

function openBinalarDb(readOnly = true) {
  return new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"), { readOnly });
}

export function loadSahaKartiData(
  binaId: number,
  options?: { abone_no?: string | null; sayac_id?: string | null }
): SahaKartiPayload {
  const aboneFilter = options?.abone_no?.trim() || null;
  const sayacFilter = options?.sayac_id?.trim() || null;
  const exportedAt = new Date().toISOString();

  let binalarDb: DatabaseSync | null = null;
  try {
    binalarDb = openBinalarDb();
    const building = binalarDb
      .prepare(`SELECT id, value, oda_id, layer FROM binalar WHERE id = ?`)
      .get(binaId) as { id: number; value: string; oda_id: number | null; layer: string | null } | undefined;

    if (!building) {
      throw new Error("Bina bulunamadı");
    }

    const infoRow = binalarDb
      .prepare(`SELECT * FROM bina_bilgi WHERE bina_id = ?`)
      .get(binaId) as Record<string, unknown> | undefined;

    const buildingInfo = infoRow
      ? {
          kat_sayisi: Number(infoRow.kat_sayisi) || 0,
          daire_sayisi: Number(infoRow.daire_sayisi) || 0,
          ortak_alan_sayisi: Number(infoRow.ortak_alan_sayisi) || 0,
          toplam_bagimsiz_bolum:
            Number(infoRow["toplam_bagımsız_bolum"] ?? infoRow.toplam_bagimsiz_bolum) || 0,
          has_zemin: Number(infoRow.has_zemin) === 1,
          ada_parsel: String(infoRow.ada_parsel ?? ""),
          sokak: String(infoRow.sokak ?? ""),
          dis_kapi_no: String(infoRow.dis_kapi_no ?? ""),
        }
      : null;

    const hasTarifeTable = Boolean(
      binalarDb
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bina_tarife_ozet'`)
        .get()
    );
    const tariffRow = hasTarifeTable
      ? (binalarDb
          .prepare(`SELECT * FROM bina_tarife_ozet WHERE bina_id = ?`)
          .get(binaId) as Record<string, unknown> | undefined)
      : undefined;

    const tariff = tariffRow
      ? {
          tarife_sinif: String(tariffRow.tarife_sinif ?? ""),
          tarife_etiket: String(tariffRow.tarife_etiket ?? ""),
          tarife_turu: String(tariffRow.tarife_turu ?? ""),
          abone_sayisi: Number(tariffRow.abone_sayisi) || 0,
          building_uavt: String(tariffRow.building_uavt ?? ""),
        }
      : null;

    let meterRows = binalarDb
      .prepare(
        `SELECT birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
                sayac_markasi, sayac_id, sicil_no, abone_no,
                COALESCE(sayac_durum, 'gecerli') AS sayac_durum, updated_at
         FROM sayac
         WHERE bina_id = ?
         ORDER BY birim_no ASC`
      )
      .all(binaId) as Array<Record<string, unknown>>;

    if (aboneFilter) {
      const target = normDigits(aboneFilter);
      meterRows = meterRows.filter((row) => normDigits(String(row.abone_no ?? "")) === target);
    }
    if (sayacFilter) {
      const target = normDigits(sayacFilter);
      meterRows = meterRows.filter((row) => normDigits(String(row.sayac_id ?? "")) === target);
    }

    const meters: SahaKartiMeter[] = meterRows.map((row) => {
      const durum = String(row.sayac_durum ?? classifySayacDurum(String(row.sayac_id ?? "")));
      const meta = durum in SAYAC_DURUM ? SAYAC_DURUM[durum as keyof typeof SAYAC_DURUM] : null;
      return {
        birim_no: Number(row.birim_no),
        blok_no: String(row.blok_no ?? ""),
        kat: String(row.kat ?? ""),
        kapi_no: String(row.kapi_no ?? ""),
        oda_sayisi: String(row.oda_sayisi ?? ""),
        kullanilis_sekli: String(row.kullanilis_sekli ?? ""),
        sayac_markasi: String(row.sayac_markasi ?? ""),
        sayac_id: String(row.sayac_id ?? ""),
        sicil_no: String(row.sicil_no ?? ""),
        abone_no: String(row.abone_no ?? ""),
        sayac_durum: durum,
        durum_etiket: meta?.etiket ?? durum,
        updated_at: row.updated_at ? String(row.updated_at) : null,
      };
    });

    const hasRezervTable = Boolean(
      binalarDb
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rezerv_abonelik'`)
        .get()
    );
    let rezervRows: SahaKartiRezervAbone[] = [];
    if (hasRezervTable) {
      const rawRezerv = binalarDb
        .prepare(
          `SELECT abone_no, sayac_no, tarife_turu, tarife_sinif, building_uavt
           FROM rezerv_abonelik
           WHERE bina_id = ?
           ORDER BY abone_no, sayac_no`
        )
        .all(binaId) as Array<Record<string, unknown>>;

      rezervRows = rawRezerv
        .filter((row) => {
          if (aboneFilter) return normDigits(String(row.abone_no ?? "")) === normDigits(aboneFilter);
          if (sayacFilter) return normDigits(String(row.sayac_no ?? "")) === normDigits(sayacFilter);
          return true;
        })
        .map((row) => ({
          abone_no: String(row.abone_no ?? ""),
          sayac_no: String(row.sayac_no ?? ""),
          tarife_turu: String(row.tarife_turu ?? ""),
          tarife_sinif: String(row.tarife_sinif ?? ""),
          building_uavt: String(row.building_uavt ?? ""),
        }));
    }

    const authDb = ensureAuthSchema();
    const auditRaw = authDb
      .prepare(
        `SELECT created_at, user_email, action, summary
         FROM audit_logs
         WHERE entity_id = ?
           AND entity IN ('sayac', 'bina_bilgi', 'bina')
         ORDER BY id DESC
         LIMIT 30`
      )
      .all(String(binaId)) as Array<Record<string, unknown>>;
    const auditRows: SahaKartiAuditEntry[] = auditRaw.map((row) => ({
      created_at: String(row.created_at ?? ""),
      user_email: String(row.user_email ?? ""),
      action: String(row.action ?? ""),
      summary: String(row.summary ?? ""),
    }));

    return {
      exported_at: exportedAt,
      bina_id: binaId,
      building_name: building.value || `Bina ${binaId}`,
      oda_id: building.oda_id,
      layer: building.layer,
      building_info: buildingInfo,
      tariff,
      meters,
      rezerv_abonelikler: rezervRows,
      islem_gecmisi: auditRows,
      filter: {
        abone_no: aboneFilter,
        sayac_id: sayacFilter,
      },
    };
  } finally {
    binalarDb?.close();
  }
}

export function buildSahaKartiFilename(payload: SahaKartiPayload, ext: "pdf" | "xlsx") {
  const slug = payload.building_name
    .toLowerCase()
    .replace(/[^a-z0-9ğüşıöçĞÜŞİÖÇ]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const date = payload.exported_at.slice(0, 10);
  const suffix = payload.filter.sayac_id
    ? `-sayac-${normDigits(payload.filter.sayac_id)}`
    : payload.filter.abone_no
      ? `-abone-${normDigits(payload.filter.abone_no)}`
      : "";
  return `saha-karti-${slug || payload.bina_id}${suffix}-${date}.${ext}`;
}
