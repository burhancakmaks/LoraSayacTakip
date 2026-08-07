export interface BinaKatLayout {
  kat_sayisi?: number;
  daire_sayisi?: number;
  ortak_alan_sayisi?: number;
  has_zemin?: number | boolean;
  toplam_bagimsiz_bolum?: number;
  toplam_bagımsız_bolum?: number;
}

const ORTAK_KULLANIM = new Set([
  "ORTAK ALAN",
  "MESCİD",
  "MESCID",
  "WC",
  "KAZAN DAİRESİ",
  "KAZAN DAIRESI",
]);

/** Bina bilgisinden birim_no → kat eşlemesi (daireler kata, ortak alanlar sona). */
export function buildKatAssignmentFromBina(bilgi: BinaKatLayout): Map<number, string> {
  const toplam =
    bilgi.toplam_bagimsiz_bolum ?? bilgi.toplam_bagımsız_bolum ?? 0;
  const ortak = bilgi.ortak_alan_sayisi ?? 0;
  const daire = bilgi.daire_sayisi ?? Math.max(0, toplam - ortak);
  const katSayisi = bilgi.kat_sayisi ?? 0;
  const hasZemin = bilgi.has_zemin === 1 || bilgi.has_zemin === true;

  const map = new Map<number, string>();
  if (toplam <= 0) return map;

  const residentialFloors: string[] = [];
  if (hasZemin) residentialFloors.push("ZEMİN KAT");
  for (let k = 1; k <= katSayisi; k++) residentialFloors.push(`${k}. KAT`);
  if (residentialFloors.length === 0 && daire > 0) {
    residentialFloors.push(katSayisi > 0 ? "1. KAT" : "ZEMİN KAT");
  }

  const daireSlots = Math.min(daire, toplam);
  const floorCount = residentialFloors.length || 1;
  let remainder = daireSlots % floorCount;
  const basePerFloor = Math.floor(daireSlots / floorCount);

  let birim = 1;
  for (let fi = 0; fi < floorCount && birim <= daireSlots; fi++) {
    const count = basePerFloor + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    const floor = residentialFloors[fi];
    for (let u = 0; u < count && birim <= daireSlots; u++) {
      map.set(birim, floor);
      birim += 1;
    }
  }

  for (let b = daireSlots + 1; b <= toplam; b++) {
    map.set(b, "ORTAK ALAN");
  }

  return map;
}

export function inferKullanilisKat(kullanilis: string): string | null {
  const u = kullanilis.toLocaleUpperCase("tr-TR").trim();
  if (ORTAK_KULLANIM.has(u)) return "ORTAK ALAN";
  if (u === "YÖNETİM" || u === "YONETIM") return "ZEMİN KAT";
  return null;
}

/** Kapı no / numaratajdan kat ipucu (ör. 3 → 3. KAT, Z1 → ZEMİN). */
export function inferKatFromKapiNo(kapiNo: string): string | null {
  const raw = kapiNo.trim();
  if (!raw) return null;

  const k = raw.toLocaleUpperCase("tr-TR");
  if (k.includes("BODRUM") || /^B\d*/.test(k)) return "BODRUM KAT";
  if (k.includes("ZEMİN") || k.includes("ZEMIN") || /^Z[\d\-]/.test(k)) return "ZEMİN KAT";
  if (k.includes("ORTAK")) return "ORTAK ALAN";

  const leading = k.match(/^(\d{1,2})/);
  if (leading) {
    const n = parseInt(leading[1], 10);
    if (n === 0) return "ZEMİN KAT";
    if (n >= 1 && n <= 30) return `${n}. KAT`;
  }

  return null;
}

export function resolveSayacKat(
  row: {
    birim_no: number;
    kat: string;
    kullanilis_sekli: string;
    kapi_no: string;
  },
  assignmentMap: Map<number, string>,
  knownByBirim: Map<number, string>
): string {
  const trimmed = row.kat.trim();
  if (trimmed) return trimmed;

  const fromBirim = knownByBirim.get(row.birim_no);
  if (fromBirim) return fromBirim;

  const fromKullanilis = inferKullanilisKat(row.kullanilis_sekli);
  if (fromKullanilis) return fromKullanilis;

  const fromKapi = inferKatFromKapiNo(row.kapi_no);
  if (fromKapi) return fromKapi;

  const fromLayout = assignmentMap.get(row.birim_no);
  if (fromLayout) return fromLayout;

  return "1. KAT";
}

export function applyInferredKatToRows<
  T extends {
    birim_no: number;
    kat: string;
    kullanilis_sekli: string;
    kapi_no: string;
  }
>(rows: T[], bilgi: BinaKatLayout): T[] {
  const assignmentMap = buildKatAssignmentFromBina(bilgi);
  const knownByBirim = new Map<number, string>();
  for (const row of rows) {
    const kat = row.kat.trim();
    if (kat) knownByBirim.set(row.birim_no, kat);
  }

  return rows.map((row) => {
    if (row.kat.trim()) return row;
    const inferred = resolveSayacKat(row, assignmentMap, knownByBirim);
    return { ...row, kat: inferred };
  });
}
