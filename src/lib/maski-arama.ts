import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

export interface MaskiAramaRecord {
  kaynak: string;
  dosya: string;
  ada: string;
  parsel: string;
  blok: string;
  kapi_no: string;
  kat: string;
  nitelik: string;
  sayac_tipi: string;
  sayac_no: string;
  abone_no: string;
  sicil_no: string;
  adres: string;
}

export interface MaskiAramaIndex {
  built_at: string;
  total: number;
  stats: Record<string, number>;
  files: Record<string, { path: string; name: string; mtime: number; size: number } | null>;
  records: MaskiAramaRecord[];
}

let cachedIndex: MaskiAramaIndex | null = null;
let cachedMtime = 0;

function indexPath() {
  return path.join(process.cwd(), "data", "maski-arama-index.json");
}

export function loadMaskiAramaIndex(): MaskiAramaIndex {
  const filePath = indexPath();
  if (!existsSync(filePath)) {
    return { built_at: "", total: 0, stats: {}, files: {}, records: [] };
  }

  const fileStat = statSync(filePath);
  if (cachedIndex && cachedMtime === fileStat.mtimeMs) return cachedIndex;

  const raw = readFileSync(filePath, "utf8");
  cachedIndex = JSON.parse(raw) as MaskiAramaIndex;
  cachedMtime = fileStat.mtimeMs;
  return cachedIndex;
}

function normDigits(v: string) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

function normText(v: string) {
  return String(v ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function scoreRecord(rec: MaskiAramaRecord, q: string, digits: string): number {
  const sayacDigits = normDigits(rec.sayac_no);
  const abone = String(rec.abone_no ?? "").trim();
  let score = 100;

  if (digits && sayacDigits === digits) score = 0;
  else if (digits && sayacDigits.includes(digits)) score = 1;
  else if (abone && abone === q) score = 2;
  else if (abone && abone.includes(q)) score = 3;
  else if (normText(rec.adres).includes(normText(q))) score = 4;
  else if (normText(rec.blok).includes(normText(q))) score = 5;
  else if (normText(rec.kapi_no).includes(normText(q))) score = 6;
  else if (normText(rec.kaynak).includes(normText(q))) score = 7;
  else score = 8;

  return score;
}

export function searchMaskiRecords(
  query: string,
  options?: { kaynak?: string; limit?: number }
): MaskiAramaRecord[] {
  const q = query.trim();
  if (!q || q.length < 2) return [];

  const index = loadMaskiAramaIndex();
  const digits = normDigits(q);
  const textQ = normText(q);
  const kaynakFilter = options?.kaynak?.trim();
  const limit = options?.limit ?? 50;

  const matches = index.records.filter((rec) => {
    if (kaynakFilter && rec.kaynak !== kaynakFilter) return false;

    if (digits && normDigits(rec.sayac_no).includes(digits)) return true;
    if (rec.abone_no && rec.abone_no.includes(q)) return true;
    if (normText(rec.adres).includes(textQ)) return true;
    if (normText(rec.blok).includes(textQ)) return true;
    if (normText(rec.kapi_no).includes(textQ)) return true;
    if (normText(rec.kat).includes(textQ)) return true;
    if (normText(rec.nitelik).includes(textQ)) return true;
    if (normText(rec.kaynak).includes(textQ)) return true;
    if (normText(rec.ada).includes(textQ)) return true;
    if (normText(rec.sayac_tipi).includes(textQ)) return true;
    if (rec.sayac_no && normText(rec.sayac_no).includes(textQ)) return true;
    return false;
  });

  return matches
    .map((rec) => ({ rec, score: scoreRecord(rec, q, digits) }))
    .sort((a, b) => a.score - b.score || a.rec.kaynak.localeCompare(b.rec.kaynak, "tr"))
    .slice(0, limit)
    .map(({ rec }) => rec);
}

export function listMaskiKaynaklar(): string[] {
  const index = loadMaskiAramaIndex();
  return [...new Set(index.records.map((r) => r.kaynak))].sort((a, b) => a.localeCompare(b, "tr"));
}
