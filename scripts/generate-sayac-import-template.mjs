/**
 * Sayaç aktarım Excel şablonu oluşturur.
 * Çıktı: public/templates/sayac-aktarim-sablonu.xlsx
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "templates");
const OUT_FILE = join(OUT_DIR, "sayac-aktarim-sablonu.xlsx");

const HEADERS = [
  "ADA/PARSEL",
  "BLOK",
  "KAT",
  "BAĞIMSIZ BÖLÜM KAPI NO",
  "NİTELİK",
  "UZAKTAN OKUMA SAYAÇ NO",
  "ABONE NO",
  "SİCİL NO",
];

const EXAMPLES = [
  ["49", "A BLOK", "1", "12", "DAİRE", "30260400", "12345678", ""],
  ["37-50", "A", "2", "5", "DAİRE", "30112233", "87654321", ""],
  ["ŞİRE", "C BLOK", "ZEMİN", "3", "DÜKKAN", "29887766", "", ""],
  ["5. ETAP", "DC8", "3", "15", "SICAK SU", "30445566", "", ""],
  ["5. ETAP", "GB1", "1", "8", "KALORIMETRE", "OKUNMADI", "", ""],
];

const ACIKLAMA = [
  ["Sayaç Aktarım Şablonu — Kullanım Kılavuzu"],
  [""],
  ["Zorunlu sütunlar", "BLOK, BAĞIMSIZ BÖLÜM KAPI NO, UZAKTAN OKUMA SAYAÇ NO"],
  ["Önerilen sütunlar", "ADA/PARSEL, KAT, NİTELİK, ABONE NO"],
  [""],
  ["ADA/PARSEL örnekleri", "49, 37-50, 46, 51, 53, 41-134, ŞİRE, 5. ETAP"],
  ["BLOK örnekleri", "A BLOK, DC8, GB1, E BLOK"],
  ["Sayaç numarası", "6–10 haneli rakam (ör. 30260400)"],
  ["Sorunlu sayaç", "OKUNMADI, TAKILMADI veya - (eksik)"],
  [""],
  ["Önemli", "Hatalı satırlar atlanır; geçerli satırlar aktarılır."],
  ["Önemli", "Her aktarım öncesi otomatik yedek alınır; Geri Al ile son aktarım geri alınabilir."],
  ["Önemli", "Başlık satırını değiştirmeyin; veri 'Sayaç Aktarım' sayfasına girilmelidir."],
];

const wb = XLSX.utils.book_new();

const dataSheet = [HEADERS, ...EXAMPLES];
const wsData = XLSX.utils.aoa_to_sheet(dataSheet);
wsData["!cols"] = [
  { wch: 12 },
  { wch: 14 },
  { wch: 8 },
  { wch: 22 },
  { wch: 14 },
  { wch: 24 },
  { wch: 12 },
  { wch: 12 },
];
XLSX.utils.book_append_sheet(wb, wsData, "Sayaç Aktarım");

const wsInfo = XLSX.utils.aoa_to_sheet(ACIKLAMA);
wsInfo["!cols"] = [{ wch: 28 }, { wch: 60 }];
XLSX.utils.book_append_sheet(wb, wsInfo, "Açıklama");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log(JSON.stringify({ ok: true, path: OUT_FILE }));
