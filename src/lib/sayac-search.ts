import type { DatabaseSync } from "node:sqlite";

export type SayacSearchHit = {
  bina_id: number;
  birim_no: number;
  blok_no: string;
  kat: string;
  kapi_no: string;
  sayac_id: string;
  abone_no: string;
  building_name: string;
  layer: string | null;
  oda_id: number | null;
  is_configured: boolean;
  coordinates: [number, number][][];
  bolge: string;
  source: "sayac" | "lora";
};

type BinaRow = {
  id: number;
  value: string | null;
  layer: string | null;
  oda_id: number | null;
  coordinates: string;
  sayacCount: number;
};

type Cache = {
  ikizceBinaIds: Set<number>;
  blokToBina: Map<string, BinaRow>;
  binaById: Map<number, BinaRow>;
  mahalleName: string;
};

let cache: Cache | null = null;

export function foldSearch(value: string) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/İ/g, "I")
    .trim();
}

export function normBlokKey(value: string) {
  return foldSearch(value)
    .replace(/\s+/g, " ")
    .replace(/\s+BLOK$/i, "")
    .trim();
}

export function sqlFold(expr: string) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    UPPER(COALESCE(${expr}, '')),
    'İ','I'), 'ı','I'), 'Ş','S'), 'Ğ','G'), 'Ü','U'), 'Ö','O'), 'Ç','C'), 'İ','I')`;
}

function pointInRing(lat: number, lng: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const intersects =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI || Number.EPSILON) + latI;
    if (intersects) inside = !inside;
  }
  return inside;
}

function centroid(coordsRaw: string): { lat: number; lng: number } | null {
  let coords: [number, number][][];
  try {
    coords = JSON.parse(coordsRaw);
  } catch {
    return null;
  }
  const ring = Array.isArray(coords[0]?.[0]) ? coords[0] : (coords as unknown as [number, number][]);
  if (!ring?.length) return null;
  let slat = 0;
  let slng = 0;
  let n = 0;
  for (const p of ring) {
    const lat = Number(p[0]);
    const lng = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    slat += lat;
    slng += lng;
    n++;
  }
  if (!n) return null;
  return { lat: slat / n, lng: slng / n };
}

function mahalleRing(raw: string): [number, number][] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const rings = parsed as [number, number][][] | [number, number][][][];
  const outer = Array.isArray((rings as [number, number][][][])[0]?.[0]?.[0])
    ? (rings as [number, number][][][])[0]
    : (rings as [number, number][][]);
  const ring = Array.isArray(outer[0]?.[0]) ? outer[0] : (outer as unknown as [number, number][]);
  return ring?.length >= 3 ? ring : null;
}

function pickCanonical(hits: BinaRow[]): BinaRow {
  const ranked = [...hits]
    .filter((h) => !/KALDIRIM/i.test(h.layer || ""))
    .sort((a, b) => {
      if ((b.sayacCount || 0) !== (a.sayacCount || 0)) return (b.sayacCount || 0) - (a.sayacCount || 0);
      const aRya = /^RYA_/i.test(a.layer || "") ? 1 : 0;
      const bRya = /^RYA_/i.test(b.layer || "") ? 1 : 0;
      if (aRya !== bRya) return aRya - bRya;
      const aMaks = /Maks_Bina/i.test(a.layer || "") ? 0 : 1;
      const bMaks = /Maks_Bina/i.test(b.layer || "") ? 0 : 1;
      if (aMaks !== bMaks) return aMaks - bMaks;
      return a.id - b.id;
    });
  return ranked[0] || hits[0];
}

function loadCache(db: DatabaseSync): Cache {
  if (cache) return cache;

  const mahalleRow =
    (db
      .prepare("SELECT name, coordinates FROM mahalleler WHERE name = ?")
      .get("İkizce Mahallesi") as { name: string; coordinates: string } | undefined) ||
    (db
      .prepare("SELECT name, coordinates FROM mahalleler WHERE name LIKE '%kizce%' LIMIT 1")
      .get() as { name: string; coordinates: string } | undefined);

  const ring = mahalleRow ? mahalleRing(mahalleRow.coordinates) : null;
  const sayacCounts = new Map(
    (
      db
        .prepare(
          `SELECT bina_id, COUNT(*) c FROM sayac
           WHERE TRIM(COALESCE(sayac_id,'')) != ''
           GROUP BY bina_id`
        )
        .all() as Array<{ bina_id: number; c: number }>
    ).map((r) => [r.bina_id, r.c])
  );

  const binalar = db.prepare("SELECT id, value, layer, oda_id, coordinates FROM binalar").all() as BinaRow[];
  const ikizceBinaIds = new Set<number>();
  const binaById = new Map<number, BinaRow>();
  const byBlok = new Map<string, BinaRow[]>();

  for (const row of binalar) {
    row.sayacCount = sayacCounts.get(row.id) || 0;
    binaById.set(row.id, row);
    if (!ring) continue;
    const c = centroid(row.coordinates);
    if (!c || !pointInRing(c.lat, c.lng, ring)) continue;
    if (/KALDIRIM/i.test(row.layer || "")) continue;
    ikizceBinaIds.add(row.id);
    const key = normBlokKey(row.value || "");
    if (!key) continue;
    if (!byBlok.has(key)) byBlok.set(key, []);
    byBlok.get(key)!.push(row);
  }

  const blokToBina = new Map<string, BinaRow>();
  for (const [key, hits] of byBlok) {
    blokToBina.set(key, pickCanonical(hits));
  }

  cache = {
    ikizceBinaIds,
    blokToBina,
    binaById,
    mahalleName: mahalleRow?.name || "İkizce Mahallesi",
  };
  return cache;
}

function parseCoords(raw: string): [number, number][][] {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function getIkizceCache(db: DatabaseSync) {
  return loadCache(db);
}

export function clearIkizceCache() {
  cache = null;
}

export function resolveIkizceBlok(db: DatabaseSync, blok: string) {
  return loadCache(db).blokToBina.get(normBlokKey(blok)) || null;
}

export function searchSayaclar(db: DatabaseSync, q: string, limit = 40): SayacSearchHit[] {
  const trimmed = q.trim();
  if (trimmed.length < 3) return [];

  const digits = trimmed.replace(/^2025-/i, "").replace(/\D/g, "");
  const digitQ = digits.length >= 5 ? digits : "";
  const folded = foldSearch(trimmed).replace(/\s+/g, " ");
  const ctx = loadCache(db);
  const ikizceQuery = folded.includes("IKIZCE");

  const foldId = sqlFold("s.sayac_id");
  const foldAbone = sqlFold("s.abone_no");
  const foldBlok = sqlFold("s.blok_no");
  const foldBina = sqlFold("b.value");

  const sayacRows = db
    .prepare(
      `
      SELECT
        s.bina_id, s.birim_no, s.blok_no, s.kat, s.kapi_no, s.sayac_id, s.abone_no,
        b.value, b.layer, b.oda_id, b.coordinates,
        EXISTS(SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS is_configured
      FROM sayac s
      JOIN binalar b ON b.id = s.bina_id
      WHERE TRIM(COALESCE(s.sayac_id, '')) != ''
        AND (
          (? != '' AND REPLACE(REPLACE(REPLACE(${foldId}, ' ', ''), '-', ''), '2025-', '') LIKE '%' || ? || '%')
          OR ${foldAbone} LIKE '%' || ? || '%'
          OR ${foldBlok} LIKE '%' || ? || '%'
          OR ${foldBina} LIKE '%' || ? || '%'
        )
      ORDER BY
        CASE
          WHEN ? != '' AND REPLACE(REPLACE(REPLACE(${foldId}, ' ', ''), '-', ''), '2025-', '') = ? THEN 0
          WHEN TRIM(COALESCE(s.abone_no,'')) = ? THEN 1
          WHEN ${foldBina} LIKE '%' || ? || '%' THEN 2
          ELSE 3
        END,
        s.sayac_id
      LIMIT ?
    `
    )
    .all(
      digitQ,
      digitQ,
      folded,
      folded,
      folded,
      digitQ,
      digitQ,
      trimmed,
      folded,
      Math.max(limit, 80)
    ) as Array<{
      bina_id: number;
      birim_no: number;
      blok_no: string;
      kat: string;
      kapi_no: string;
      sayac_id: string;
      abone_no: string;
      value: string | null;
      layer: string | null;
      oda_id: number | null;
      coordinates: string;
      is_configured: number;
    }>;

  const hits: SayacSearchHit[] = [];
  const seen = new Set<string>();

  const push = (hit: SayacSearchHit) => {
    const key = `${hit.source}:${hit.sayac_id}:${hit.bina_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  for (const row of sayacRows) {
    const inIkizce = ctx.ikizceBinaIds.has(row.bina_id);
    if (!ikizceQuery || inIkizce || foldSearch(row.value || "").includes("IKIZCE") || foldSearch(row.blok_no || "").includes("IKIZCE")) {
      push({
        bina_id: row.bina_id,
        birim_no: row.birim_no,
        blok_no: row.blok_no || "",
        kat: row.kat || "",
        kapi_no: row.kapi_no || "",
        sayac_id: row.sayac_id,
        abone_no: row.abone_no || "",
        building_name: row.value || "Bilinmeyen Bina",
        layer: row.layer,
        oda_id: row.oda_id,
        is_configured: !!row.is_configured,
        coordinates: parseCoords(row.coordinates),
        bolge: inIkizce ? ctx.mahalleName : "",
        source: "sayac",
      });
    }
  }

  if (ikizceQuery && ctx.ikizceBinaIds.size) {
    const ids = [...ctx.ikizceBinaIds];
    const extra = db
      .prepare(
        `
        SELECT
          s.bina_id, s.birim_no, s.blok_no, s.kat, s.kapi_no, s.sayac_id, s.abone_no,
          b.value, b.layer, b.oda_id, b.coordinates,
          EXISTS(SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS is_configured
        FROM sayac s
        JOIN binalar b ON b.id = s.bina_id
        WHERE TRIM(COALESCE(s.sayac_id, '')) != ''
          AND s.bina_id IN (${ids.map(() => "?").join(",")})
        ORDER BY s.sayac_id
        LIMIT ?
      `
      )
      .all(...ids, limit) as typeof sayacRows;
    for (const row of extra) {
      push({
        bina_id: row.bina_id,
        birim_no: row.birim_no,
        blok_no: row.blok_no || "",
        kat: row.kat || "",
        kapi_no: row.kapi_no || "",
        sayac_id: row.sayac_id,
        abone_no: row.abone_no || "",
        building_name: row.value || "Bilinmeyen Bina",
        layer: row.layer,
        oda_id: row.oda_id,
        is_configured: !!row.is_configured,
        coordinates: parseCoords(row.coordinates),
        bolge: ctx.mahalleName,
        source: "sayac",
      });
    }
  }

  const hasLora = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lora_devices'").get();
  if (hasLora) {
    const foldDev = sqlFold("d.dev_eui");
    const foldBol = sqlFold("d.bolge");
    const foldLoraBlok = sqlFold("d.blok");
    const foldDaire = sqlFold("d.daire");
    const loraRows = db
      .prepare(
        `
        SELECT d.dev_eui, d.bolge, d.blok, d.daire, d.kat, d.bina_id
        FROM lora_devices d
        WHERE
          ${foldDev} LIKE '%' || ? || '%'
          OR ${foldBol} LIKE '%' || ? || '%'
          OR ${foldLoraBlok} LIKE '%' || ? || '%'
          OR ${foldDaire} LIKE '%' || ? || '%'
          OR (? != '' AND REPLACE(REPLACE(${foldDev}, ' ', ''), '-', '') LIKE '%' || ? || '%')
        ORDER BY
          CASE
            WHEN REPLACE(REPLACE(${foldDev}, ' ', ''), '-', '') = ? THEN 0
            WHEN ${foldBol} LIKE '%' || ? || '%' THEN 1
            ELSE 2
          END,
          d.blok, d.daire, d.dev_eui
        LIMIT ?
      `
      )
      .all(folded, folded, folded, folded, digitQ, digitQ, folded, folded, limit) as Array<{
        dev_eui: string;
        bolge: string;
        blok: string;
        daire: string;
        kat: string;
        bina_id: number | null;
      }>;

    for (const row of loraRows) {
      if (hits.some((h) => foldSearch(h.sayac_id) === foldSearch(row.dev_eui))) continue;
      const mapped = row.bina_id ? ctx.binaById.get(row.bina_id) : ctx.blokToBina.get(normBlokKey(row.blok || ""));
      if (!mapped) continue;
      push({
        bina_id: mapped.id,
        birim_no: 0,
        blok_no: row.blok || mapped.value || "",
        kat: row.kat || "",
        kapi_no: row.daire || "",
        sayac_id: row.dev_eui,
        abone_no: "",
        building_name: mapped.value || ctx.mahalleName,
        layer: mapped.layer,
        oda_id: mapped.oda_id,
        is_configured: mapped.sayacCount > 0,
        coordinates: parseCoords(mapped.coordinates),
        bolge: row.bolge || ctx.mahalleName,
        source: "lora",
      });
    }
  }

  hits.sort((a, b) => {
    const aExact = digitQ && foldSearch(a.sayac_id).replace(/\D/g, "") === digitQ ? 0 : 1;
    const bExact = digitQ && foldSearch(b.sayac_id).replace(/\D/g, "") === digitQ ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.source !== b.source) return a.source === "sayac" ? -1 : 1;
    return a.sayac_id.localeCompare(b.sayac_id);
  });

  const sayacHits = hits.filter((h) => h.source === "sayac");
  const loraHits = hits.filter((h) => h.source === "lora");
  if (loraHits.length) {
    return [...sayacHits.slice(0, 25), ...loraHits.slice(0, 15)].slice(0, limit);
  }

  return sayacHits.slice(0, limit);
}
