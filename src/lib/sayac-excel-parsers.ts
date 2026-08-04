import * as XLSX from "xlsx";
import type { DatabaseSync } from "node:sqlite";
import {
  SHEET_5ETAP,
  buildBlokResolver,
  normBlok,
  normalizeAdaParsel,
  resolve4EtapBinaId,
  resolveBinaId,
} from "./sayac-blok-resolver";

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

const TEMPLATE_SHEET_NAME = "Sayaç Aktarım";

function extractDigits(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

function classifySayac(raw: unknown): SayacDurum {
  const s = String(raw ?? "").trim();
  if (!s) return "eksik";
  if (/OKUNMADI|OKUNAMADI|TAKILAMADI|TAKILMADI|SAYA[CÇ]\s*YOK|SAYAC\s*TAKIL/i.test(s)) return "okunmadi";
  if (s === "-" || /^YOK$/i.test(s) || /^-+$/.test(s)) return "eksik";
  const digits = extractDigits(s);
  if (digits.length >= 6 && digits.length <= 10) return "gecerli";
  return "hatali";
}

function parseSayacCell(raw: unknown): { sayacId: string; durum: SayacDurum } | null {
  const durum = classifySayac(raw);
  if (durum === "hatali") return null;
  const s = String(raw ?? "").trim();
  if (durum === "okunmadi") return { sayacId: "OKUNMADI", durum };
  if (durum === "eksik") return { sayacId: "", durum };
  return { sayacId: s, durum: "gecerli" };
}

const COLS_5ETAP = [
  { idx: 1, tip: "SICAK SU" },
  { idx: 2, tip: "KALORIMETRE" },
  { idx: 3, tip: "SOGUK SU" },
  { idx: 4, tip: "KAZAN SOGUK" },
  { idx: 5, tip: "KAZAN KALORI" },
];

function normHeader(s: unknown): string {
  return String(s ?? "")
    .toLocaleUpperCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function colIndex(headerRow: unknown[], patterns: RegExp[]): number {
  for (let i = 0; i < headerRow.length; i++) {
    const h = normHeader(headerRow[i]);
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

function findHeaderRow(data: unknown[][]): number {
  for (let i = 0; i < Math.min(30, data.length); i++) {
    const row = data[i] ?? [];
    const cSayac = colIndex(row, [/SAYAC/, /UZAKTAN/, /SAYACNO/]);
    const cBlok = colIndex(row, [/BLOK/]);
    const cKapi = colIndex(row, [/BAGIMSIZ/, /KAPI/, /BOLUM/, /DAIRE/, /NUMARATAJ/]);
    if (cSayac >= 0 && (cBlok >= 0 || cKapi >= 0)) return i;
  }
  return data.length > 2 ? 2 : -1;
}

function isBlokRow(blok: string): boolean {
  const b = normBlok(blok);
  if (!b || b.length > 40) return false;
  if (/^\d{7,}$/.test(b.replace(/\s/g, ""))) return false;
  return /^[A-Z0-9ÇĞİÖŞÜ]+(\s+BLOK)?$/i.test(b) || /^(DB|DC|GB)-?\d+$/i.test(b);
}

export function detectAdaHint(filename: string, sheetNames: string[]): string {
  const ctx = `${filename} ${sheetNames.join(" ")}`.toUpperCase();
  if (/4\.?\s*ETAP|4\s*ETAP/.test(ctx)) return "4. ETAP";
  if (/5\.?\s*ETAP|5\s*ETAP/.test(ctx)) return "5. ETAP";
  if (/49\s*ADA/.test(ctx)) return "49";
  if (/41-134|41\s*134/.test(ctx)) return "41-134";
  if (/37-50.*E\s*BLOK/.test(ctx)) return "37-50";
  if (/37-50|A-B/.test(ctx)) return "37-50";
  if (/46\s*ADA/.test(ctx)) return "46";
  if (/51\s*ADA/.test(ctx)) return "51";
  if (/53\s*ADA/.test(ctx)) return "53";
  if (/ŞİRE|SIRE|PAZAR/.test(ctx)) return "ŞİRE";
  return "";
}

function pickDataSheet(wb: XLSX.WorkBook, preferCarsaf = false): string {
  if (preferCarsaf) {
    const carsaf = wb.SheetNames.find((s) => /ÇARŞAF|CARSAF/i.test(s));
    if (carsaf) return carsaf;
  }
  const exact = wb.SheetNames.find((s) => normHeader(s) === normHeader(TEMPLATE_SHEET_NAME));
  if (exact) return exact;
  const birim = wb.SheetNames.find((s) => /BAGIMSIZ\s+BIRIM/i.test(normHeader(s)));
  if (birim) return birim;
  return wb.SheetNames[wb.SheetNames.length - 1] ?? wb.SheetNames[0];
}

function toRow(
  rowNum: number,
  adaParsel: string,
  blok: string,
  kapiNo: string,
  kat: string,
  nitelik: string,
  sayacRaw: string,
  binaId: number | null
): ParsedSayacRow | null {
  const parsed = parseSayacCell(sayacRaw);
  if (!parsed || !kapiNo) return null;
  return {
    rowNum,
    adaParsel: normalizeAdaParsel(adaParsel),
    blok,
    kat,
    kapiNo,
    nitelik: nitelik || "DAİRE",
    sayacRaw: String(sayacRaw ?? "").trim(),
    sayacId: parsed.sayacId,
    aboneNo: "",
    sicilNo: "",
    durum: parsed.durum,
    binaId,
  };
}

function parse5Etap(wb: XLSX.WorkBook): ParsedSayacRow[] {
  const rows: ParsedSayacRow[] = [];
  let rowCounter = 0;
  for (const sheet of wb.SheetNames) {
    const binaId = SHEET_5ETAP[sheet.trim().toUpperCase()];
    if (!binaId) continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" }) as unknown[][];
    for (let r = 2; r < data.length; r++) {
      const daire = String(data[r]?.[0] ?? "").trim();
      if (!daire || daire === "KAPICI") continue;
      for (const col of COLS_5ETAP) {
        const raw = data[r]?.[col.idx];
        if (raw === undefined || raw === null || String(raw).trim() === "") continue;
        rowCounter++;
        const item = toRow(rowCounter, "5. ETAP", sheet, daire, "", col.tip, String(raw), binaId);
        if (item) rows.push(item);
      }
    }
  }
  return rows;
}

function is4EtapWorkbook(wb: XLSX.WorkBook, filename: string): boolean {
  if (/4\.?\s*ETAP|4\s*ETAP/i.test(filename)) return true;
  const adaSheets = wb.SheetNames.filter((s) => /ADA-\d+/i.test(s));
  if (!adaSheets.length) return false;
  for (const sheet of adaSheets) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" }) as unknown[][];
    const headerRow = data[1] ?? [];
    if (headerRow.some((h) => /^(DB|DC|GB)-/.test(String(h ?? "").trim()))) return true;
  }
  return false;
}

function parse4Etap(wb: XLSX.WorkBook): ParsedSayacRow[] {
  const rows: ParsedSayacRow[] = [];
  let rowCounter = 0;
  for (const sheetName of wb.SheetNames) {
    const adaM = sheetName.match(/ADA-(\d+)/i);
    if (!adaM) continue;
    const ada = adaM[1].padStart(2, "0");
    const adaParsel = `4. ETAP ADA-${ada}`;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" }) as unknown[][];
    const headerRow = data[1] ?? [];
    const colBlok: Record<number, string> = {};
    for (let c = 1; c < headerRow.length; c++) {
      const h = String(headerRow[c] ?? "").trim();
      if (h && /^(DB|DC|GB)-/.test(h)) colBlok[c] = h.replace(/\*$/, "");
    }
    if (!Object.keys(colBlok).length) continue;
    for (let r = 3; r < data.length; r++) {
      const row = data[r] ?? [];
      for (const [cStr, blok] of Object.entries(colBlok)) {
        const c = Number(cStr);
        const kapiNo = String(row[c] ?? "").trim();
        const sayacRaw = String(row[c + 1] ?? "").trim();
        if (!kapiNo && !sayacRaw) continue;
        if (!kapiNo) continue;
        const binaId = resolve4EtapBinaId(ada, blok);
        rowCounter++;
        const item = toRow(rowCounter, adaParsel, blok, kapiNo, "", "SOGUK SU", sayacRaw, binaId);
        if (item) rows.push(item);
      }
    }
  }
  return rows;
}

function parse3750(wb: XLSX.WorkBook, resolve: ReturnType<typeof buildBlokResolver>): ParsedSayacRow[] {
  const sheet = pickDataSheet(wb, true);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" }) as unknown[][];
  const rows: ParsedSayacRow[] = [];
  for (let r = 2; r < data.length; r++) {
    const row = data[r] ?? [];
    if (!row[0] || Number.isNaN(Number(row[0]))) continue;
    const blok = String(row[3] ?? "").trim();
    const daire = String(row[4] ?? "").trim();
    const kat = String(row[5] ?? "").trim();
    const tip = String(row[6] ?? "DAİRE").trim() || "DAİRE";
    const sayacRaw = String(row[7] ?? "").trim();
    const binaId = resolveBinaId(resolve, "37-50", blok);
    const item = toRow(r + 1, "37-50", blok, daire, kat, tip, sayacRaw, binaId);
    if (item) rows.push(item);
  }
  return rows;
}

function parseStandardSheet(
  data: unknown[][],
  adaHint: string,
  resolve: ReturnType<typeof buildBlokResolver>,
  fallbackBlok = ""
): ParsedSayacRow[] {
  const headerIdx = findHeaderRow(data);
  if (headerIdx < 0) return [];

  const headerRow = data[headerIdx] ?? [];
  const cAda = colIndex(headerRow, [/ADA/, /PARSEL/]);
  const cBlok = colIndex(headerRow, [/BLOK/]);
  const cKat = colIndex(headerRow, [/KAT/]);
  const cKapi = colIndex(headerRow, [/BAGIMSIZ/, /KAPI/, /BOLUM/, /DAIRE/, /NUMARATAJ/]);
  const cNitelik = colIndex(headerRow, [/NITEL/, /KULLAN/]);
  const cSayac = colIndex(headerRow, [/SAYAC/, /UZAKTAN/, /SAYACNO/]);
  const cAbone = colIndex(headerRow, [/ABONE/]);

  if (cSayac < 0) return [];

  const rows: ParsedSayacRow[] = [];
  for (let r = headerIdx + 1; r < data.length; r++) {
    const row = data[r] ?? [];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;

    const blok = String(
      row[cBlok >= 0 ? cBlok : 0] ?? fallbackBlok
    ).trim() || fallbackBlok;
    if (!blok || !isBlokRow(blok)) continue;

    const kapiNo = String(row[cKapi >= 0 ? cKapi : 1] ?? "").trim();
    const sayacRaw = String(row[cSayac] ?? "").trim();
    const adaParsel = normalizeAdaParsel(cAda >= 0 ? row[cAda] : adaHint);
    const kat = cKat >= 0 ? String(row[cKat] ?? "").trim() : "";
    const nitelik = (cNitelik >= 0 ? String(row[cNitelik] ?? "").trim() : "") || "DAİRE";
    const aboneNo = cAbone >= 0 ? String(row[cAbone] ?? "").trim() : "";

    const binaId = resolveBinaId(resolve, adaParsel, blok);
    const item = toRow(r + 1, adaParsel, blok, kapiNo, kat, nitelik, sayacRaw, binaId);
    if (!item) continue;
    item.aboneNo = aboneNo;
    rows.push(item);
  }
  return rows;
}

function parseSireSheet(data: unknown[][], resolve: ReturnType<typeof buildBlokResolver>, sheetName: string): ParsedSayacRow[] {
  const headerIdx = findHeaderRow(data);
  const start = headerIdx >= 0 ? headerIdx + 1 : 1;
  const rows: ParsedSayacRow[] = [];
  for (let r = start; r < data.length; r++) {
    const row = data[r] ?? [];
    const blok = String(row[1] ?? sheetName).trim();
    const kapiNo = String(row[2] ?? "").trim();
    const kat = String(row[3] ?? "").trim();
    const nitelik = String(row[4] ?? "DAİRE").trim() || "DAİRE";
    const sayacRaw = String(row[5] ?? row[6] ?? "").trim();
    const binaId = resolveBinaId(resolve, "ŞİRE", blok);
    const item = toRow(r + 1, "ŞİRE", blok, kapiNo, kat, nitelik, sayacRaw, binaId);
    if (item) rows.push(item);
  }
  return rows;
}

export function parseWorkbookRows(
  buffer: Buffer,
  db: DatabaseSync,
  filename = ""
): { rows: ParsedSayacRow[]; format: string } {
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (!wb.SheetNames.length) return { rows: [], format: "empty" };

  const adaHint = detectAdaHint(filename, wb.SheetNames);
  const resolve = buildBlokResolver(db);

  const etap5 = parse5Etap(wb);
  if (etap5.length >= 3) return { rows: etap5, format: "5-etap" };

  if (is4EtapWorkbook(wb, filename)) {
    const etap4 = parse4Etap(wb);
    if (etap4.length >= 1) return { rows: etap4, format: "4-etap" };
  }

  if (/37-50|A-B/i.test(`${filename} ${wb.SheetNames.join(" ")}`)) {
    const ab = parse3750(wb, resolve);
    if (ab.length >= 3) return { rows: ab, format: "37-50-ab" };
  }

  if (/ŞİRE|SIRE|PAZAR/i.test(`${filename} ${wb.SheetNames.join(" ")}`)) {
    const all: ParsedSayacRow[] = [];
    for (const sheet of wb.SheetNames) {
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" }) as unknown[][];
      all.push(...parseSireSheet(data, resolve, sheet));
    }
    if (all.length >= 1) return { rows: all, format: "sire" };
  }

  const multiSheet: ParsedSayacRow[] = [];
  const sheetOrder = [
    ...wb.SheetNames.filter((s) => /BAGIMSIZ\s+BIRIM/i.test(normHeader(s))),
    ...wb.SheetNames.filter((s) => !/BAGIMSIZ\s+BIRIM/i.test(normHeader(s))),
  ];
  for (const sheetName of sheetOrder) {
    if (/SAYFA|SHEET|AÇIKLAMA|ACIKLAMA|DASH|GENEL\s+TABLO/i.test(normHeader(sheetName))) continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" }) as unknown[][];
    const fallbackBlok = sheetName.replace(/\s+/g, " ").trim();
    multiSheet.push(...parseStandardSheet(data, adaHint, resolve, fallbackBlok));
  }
  if (multiSheet.length >= 1) return { rows: multiSheet, format: adaHint ? `maski-${adaHint}` : "maski" };

  const sheet = pickDataSheet(wb);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" }) as unknown[][];
  const std = parseStandardSheet(data, adaHint, resolve);
  return { rows: std, format: "standard" };
}
