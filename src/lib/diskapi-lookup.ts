import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface DiskapiDoor {
  diskapi_id: number;
  kapi_no: string;
  lat: number;
  lng: number;
  alignment: string;
  edge_distance_m: number | null;
}

export interface DiskapiBinaEntry {
  primary_kapi: string;
  doors: DiskapiDoor[];
}

export interface DiskapiByBinaIndex {
  built_at: string;
  source: string;
  total_binalar: number;
  binalar: Record<string, DiskapiBinaEntry>;
}

let cached: DiskapiByBinaIndex | null = null;
let cachedMtime = 0;

function filePath() {
  return path.join(process.cwd(), "data", "diskapi-by-bina.json");
}

export function loadDiskapiByBina(): DiskapiByBinaIndex {
  const fp = filePath();
  if (!existsSync(fp)) {
    return { built_at: "", source: "", total_binalar: 0, binalar: {} };
  }

  const st = statSync(fp);
  if (cached && cachedMtime === st.mtimeMs) return cached;

  cached = JSON.parse(readFileSync(fp, "utf8")) as DiskapiByBinaIndex;
  cachedMtime = st.mtimeMs;
  return cached;
}

export function normKapiNo(v: string) {
  return String(v ?? "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, "");
}

export function searchDiskapiDoors(query: string, limit = 25) {
  const q = query.trim();
  if (!q || q.length < 2) return [];

  const normQ = normKapiNo(q);
  const index = loadDiskapiByBina();
  const hits: Array<{
    bina_id: number;
    kapi_no: string;
    lat: number;
    lng: number;
    door: DiskapiDoor;
    score: number;
  }> = [];

  for (const [binaId, entry] of Object.entries(index.binalar)) {
    for (const door of entry.doors) {
      const normK = normKapiNo(door.kapi_no);
      if (!normK) continue;
      let score = 99;
      if (normK === normQ) score = 0;
      else if (normK.startsWith(normQ)) score = 1;
      else if (normK.includes(normQ)) score = 2;
      else continue;

      hits.push({
        bina_id: Number(binaId),
        kapi_no: door.kapi_no,
        lat: door.lat,
        lng: door.lng,
        door,
        score,
      });
    }
  }

  return hits
    .sort(
      (a, b) =>
        a.score - b.score ||
        normKapiNo(a.kapi_no).localeCompare(normKapiNo(b.kapi_no), "tr") ||
        a.bina_id - b.bina_id
    )
    .slice(0, limit);
}

/** Bina için dış kapı koordinatı — önce istenen numara, sonra primary_kapi, sonra en iyi kapı */
export function getDiskapiDoorForBina(binaId: number, preferredKapiNo?: string): DiskapiDoor | null {
  const index = loadDiskapiByBina();
  const entry = index.binalar[String(binaId)];
  if (!entry?.doors?.length) return null;

  const pick = (kapiNo: string) => {
    const norm = normKapiNo(kapiNo);
    if (!norm) return null;
    return entry.doors.find((d) => normKapiNo(d.kapi_no) === norm) ?? null;
  };

  const preferred = preferredKapiNo?.trim();
  if (preferred) {
    const hit = pick(preferred);
    if (hit) return hit;
  }

  if (entry.primary_kapi) {
    const hit = pick(entry.primary_kapi);
    if (hit) return hit;
  }

  return entry.doors[0] ?? null;
}
