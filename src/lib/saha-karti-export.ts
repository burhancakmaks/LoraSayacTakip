import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { SAYAC_DURUM } from "@/lib/sayac-durum";
import { PDF_FONT, registerTurkishPdfFont } from "@/lib/saha-karti-pdf-font";
import type { SahaKartiPayload } from "./saha-karti-data";

const BRAND = {
  primary: [11, 165, 236] as [number, number, number],
  primaryDark: [2, 106, 162] as [number, number, number],
  slate: [52, 64, 84] as [number, number, number],
  muted: [102, 112, 133] as [number, number, number],
  border: [228, 231, 236] as [number, number, number],
  surface: [249, 250, 251] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

type JsPdfWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("tr-TR");
  } catch {
    return iso.slice(0, 10);
  }
}

function documentRef(payload: SahaKartiPayload) {
  const date = payload.exported_at.slice(0, 10).replace(/-/g, "");
  return `SK-${payload.bina_id}-${date}`;
}

function addressLine(payload: SahaKartiPayload) {
  const info = payload.building_info;
  if (!info) return "—";
  const parts = [
    info.sokak,
    info.dis_kapi_no ? `No ${info.dis_kapi_no}` : "",
    info.ada_parsel ? `Ada/Parsel ${info.ada_parsel}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function computeStats(payload: SahaKartiPayload) {
  const toplam = payload.building_info?.toplam_bagimsiz_bolum ?? payload.meters.length;
  const sayacDolu = payload.meters.filter((m) => m.sayac_id.trim()).length;
  const aboneDolu = payload.meters.filter((m) => m.abone_no.trim()).length;
  const doluluk = toplam > 0 ? Math.round((sayacDolu / toplam) * 100) : 0;
  return { toplam, sayacDolu, aboneDolu, doluluk };
}

function filterLabel(payload: SahaKartiPayload) {
  if (payload.filter.sayac_id) return `Sayaç: ${payload.filter.sayac_id}`;
  if (payload.filter.abone_no) return `Abone: ${payload.filter.abone_no}`;
  return null;
}

function summaryRows(payload: SahaKartiPayload): string[][] {
  const info = payload.building_info;
  const rows: string[][] = [
    ["Bina adı", payload.building_name],
    ["Bina kimliği", String(payload.bina_id)],
    ["ODA ID", payload.oda_id != null ? String(payload.oda_id) : "—"],
    ["Katman / bölge", payload.layer || "—"],
    ["Adres", addressLine(payload)],
  ];

  if (info) {
    rows.push(
      ["Kat sayısı", String(info.kat_sayisi)],
      ["Daire / ortak alan", `${info.daire_sayisi} / ${info.ortak_alan_sayisi}`],
      ["Toplam bağımsız bölüm", String(info.toplam_bagimsiz_bolum)],
      ["Zemin kat", info.has_zemin ? "Var" : "Yok"]
    );
  }

  if (payload.tariff) {
    rows.push(
      ["Tarife sınıfı", payload.tariff.tarife_etiket],
      ["Tarife türü", payload.tariff.tarife_turu || "—"],
      ["Rezerv abone sayısı", String(payload.tariff.abone_sayisi)],
      ["UAVT", payload.tariff.building_uavt || "—"]
    );
  }

  const filter = filterLabel(payload);
  if (filter) rows.push(["Çıktı kapsamı", filter]);

  return rows;
}

function durumColor(durum: string): [number, number, number] {
  const meta = durum in SAYAC_DURUM ? SAYAC_DURUM[durum as keyof typeof SAYAC_DURUM] : null;
  if (!meta) return BRAND.surface;
  const hex = meta.color.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return [
    Math.round(r + (255 - r) * 0.88),
    Math.round(g + (255 - g) * 0.88),
    Math.round(b + (255 - b) * 0.88),
  ];
}

function drawPageChrome(doc: jsPDF, payload: SahaKartiPayload) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BRAND.border);
    doc.setLineWidth(0.2);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFont(PDF_FONT, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.muted);
    doc.text("Lora Sayaç Takip · Resmi Saha Kartı", 14, pageHeight - 7);
    doc.text(documentRef(payload), pageWidth / 2, pageHeight - 7, { align: "center" });
    doc.text(`Sayfa ${page} / ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: "right" });
  }
}

function drawDocumentHeader(doc: jsPDF, payload: SahaKartiPayload) {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(...BRAND.primaryDark);
  doc.rect(0, 0, pageWidth, 34, "F");
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 30, pageWidth, 4, "F");

  doc.setTextColor(...BRAND.white);
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(17);
  doc.text("Saha Kartı", 14, 13);

  doc.setFontSize(8.5);
  doc.setFont(PDF_FONT, "normal");
  doc.text("Lora Sayaç Takip Sistemi", 14, 19.5);

  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(8);
  doc.text(documentRef(payload), pageWidth - 14, 12, { align: "right" });
  doc.setFont(PDF_FONT, "normal");
  doc.text(formatDate(payload.exported_at), pageWidth - 14, 18, { align: "right" });
  doc.text(formatShortDate(payload.exported_at), pageWidth - 14, 23, { align: "right" });

  const filter = filterLabel(payload);
  let titleY = 44;
  if (filter) {
    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(247, 144, 9);
    doc.roundedRect(14, 38, pageWidth - 28, 8, 2, 2, "FD");
    doc.setTextColor(180, 83, 9);
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, "bold");
    doc.text(`Filtreli çıktı · ${filter}`, 18, 43.2);
    titleY = 52;
  }

  doc.setTextColor(16, 24, 40);
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(13);
  doc.text(payload.building_name, 14, titleY);

  doc.setFont(PDF_FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.muted);
  const sub = [
    payload.oda_id != null ? `ODA ${payload.oda_id}` : null,
    payload.layer || null,
    addressLine(payload) !== "—" ? addressLine(payload) : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (sub) doc.text(sub, 14, titleY + 5);

  return titleY + (sub ? 11 : 7);
}

function drawStatsRow(doc: jsPDF, payload: SahaKartiPayload, startY: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const stats = computeStats(payload);
  const gap = 4;
  const boxW = (pageWidth - 28 - gap * 3) / 4;
  const items = [
    { label: "Beklenen birim", value: String(stats.toplam) },
    { label: "Kayıtlı sayaç", value: String(stats.sayacDolu) },
    { label: "Abone nolu", value: String(stats.aboneDolu) },
    { label: "Doluluk", value: `%${stats.doluluk}` },
  ];

  items.forEach((item, index) => {
    const x = 14 + index * (boxW + gap);
    doc.setFillColor(...BRAND.surface);
    doc.setDrawColor(...BRAND.border);
    doc.roundedRect(x, startY, boxW, 16, 2, 2, "FD");

    doc.setFont(PDF_FONT, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.muted);
    doc.text(item.label, x + 3, startY + 5);

    doc.setFont(PDF_FONT, "bold");
    doc.setFontSize(12);
    doc.setTextColor(16, 24, 40);
    doc.text(item.value, x + 3, startY + 12.5);
  });

  return startY + 22;
}

function drawSectionTitle(doc: jsPDF, title: string, y: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BRAND.surface);
  doc.setDrawColor(...BRAND.border);
  doc.roundedRect(14, y, pageWidth - 28, 7, 1.5, 1.5, "FD");
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.slate);
  doc.text(title, 17, y + 4.8);
  return y + 10;
}

function ensureSpace(doc: jsPDF, cursorY: number, needed = 24) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (cursorY > pageHeight - needed) {
    doc.addPage();
    return 20;
  }
  return cursorY;
}

const TABLE_BASE = {
  margin: { left: 14, right: 14 },
  styles: {
    font: PDF_FONT,
    fontSize: 7.5,
    cellPadding: 2.2,
    lineColor: BRAND.border,
    lineWidth: 0.1,
    textColor: [16, 24, 40] as [number, number, number],
  },
  headStyles: {
    font: PDF_FONT,
    fillColor: BRAND.slate,
    textColor: 255,
    fontStyle: "bold" as const,
    fontSize: 7.5,
  },
  alternateRowStyles: {
    fillColor: [252, 252, 253] as [number, number, number],
  },
};

export function buildSahaKartiPdf(payload: SahaKartiPayload): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  registerTurkishPdfFont(doc);

  let cursorY = drawDocumentHeader(doc, payload);
  cursorY = drawStatsRow(doc, payload, cursorY);
  cursorY = drawSectionTitle(doc, "Bina Özeti", cursorY);

  autoTable(doc, {
    ...TABLE_BASE,
    startY: cursorY,
    theme: "grid",
    head: [["Alan", "Değer"]],
    body: summaryRows(payload),
    columnStyles: {
      0: { cellWidth: 48, fontStyle: "bold", textColor: BRAND.muted },
      1: { cellWidth: "auto" },
    },
  });

  cursorY = (doc as JsPdfWithAutoTable).lastAutoTable?.finalY ?? cursorY;
  cursorY = ensureSpace(doc, cursorY + 6, 30);
  cursorY = drawSectionTitle(doc, `Sayaç Listesi (${payload.meters.length})`, cursorY);

  autoTable(doc, {
    ...TABLE_BASE,
    startY: cursorY,
    theme: "striped",
    head: [["Kapı", "Kat", "Kullanım", "Oda", "Sayaç No", "Abone No", "Marka", "Durum"]],
    body: payload.meters.map((m) => [
      m.kapi_no || String(m.birim_no),
      m.kat || "—",
      m.kullanilis_sekli,
      m.oda_sayisi || "—",
      m.sayac_id || "—",
      m.abone_no || "—",
      m.sayac_markasi || "—",
      m.durum_etiket,
    ]),
    columnStyles: {
      4: { fontStyle: "bold" },
      7: { halign: "center" },
    },
    didParseCell(data) {
      if (data.section !== "body" || data.column.index !== 7) return;
      const row = payload.meters[data.row.index];
      if (!row) return;
      data.cell.styles.fillColor = durumColor(row.sayac_durum);
      data.cell.styles.fontStyle = "bold";
    },
  });

  cursorY = (doc as JsPdfWithAutoTable).lastAutoTable?.finalY ?? cursorY;

  if (payload.rezerv_abonelikler.length > 0) {
    cursorY = ensureSpace(doc, cursorY + 6, 30);
    cursorY = drawSectionTitle(
      doc,
      `Rezerv Abonelik Kayıtları (${payload.rezerv_abonelikler.length})`,
      cursorY
    );
    autoTable(doc, {
      ...TABLE_BASE,
      startY: cursorY,
      theme: "striped",
      head: [["Abone No", "Sayaç No", "Tarife Türü", "Tarife Sınıfı"]],
      body: payload.rezerv_abonelikler.map((r) => [
        r.abone_no || "—",
        r.sayac_no || "—",
        r.tarife_turu || "—",
        r.tarife_sinif || "—",
      ]),
      columnStyles: {
        0: { fontStyle: "bold" },
        1: { fontStyle: "bold" },
      },
    });
    cursorY = (doc as JsPdfWithAutoTable).lastAutoTable?.finalY ?? cursorY;
  }

  if (payload.islem_gecmisi.length > 0) {
    cursorY = ensureSpace(doc, cursorY + 6, 30);
    cursorY = drawSectionTitle(doc, `İşlem Geçmişi (${payload.islem_gecmisi.length})`, cursorY);
    autoTable(doc, {
      ...TABLE_BASE,
      startY: cursorY,
      theme: "striped",
      head: [["Tarih", "Kullanıcı", "İşlem", "Özet"]],
      body: payload.islem_gecmisi.map((log) => [
        formatDate(log.created_at),
        log.user_email || "—",
        log.action || "—",
        log.summary || "—",
      ]),
      styles: { ...TABLE_BASE.styles, fontSize: 7 },
      columnStyles: {
        3: { cellWidth: 72 },
      },
    });
  }

  drawPageChrome(doc, payload);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

function setColumnWidths(sheet: XLSX.WorkSheet, widths: number[]) {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
}

export function buildSahaKartiExcel(payload: SahaKartiPayload): Buffer {
  const wb = XLSX.utils.book_new();
  const stats = computeStats(payload);

  const coverRows: (string | number)[][] = [
    ["LORA SAYAÇ TAKİP — SAHA KARTI"],
    [""],
    ["Belge No", documentRef(payload)],
    ["Oluşturma", formatDate(payload.exported_at)],
    ["Bina", payload.building_name],
    ["Bina ID", payload.bina_id],
    ["ODA ID", payload.oda_id ?? "—"],
    ["Katman", payload.layer || "—"],
    ["Adres", addressLine(payload)],
    [""],
    ["Özet"],
    ["Beklenen birim", stats.toplam],
    ["Kayıtlı sayaç", stats.sayacDolu],
    ["Abone nolu", stats.aboneDolu],
    ["Doluluk", `%${stats.doluluk}`],
  ];

  const filter = filterLabel(payload);
  if (filter) coverRows.splice(9, 0, ["Çıktı kapsamı", filter]);

  if (payload.tariff) {
    coverRows.push(
      [""],
      ["Tarife"],
      ["Sınıf", payload.tariff.tarife_etiket],
      ["Tür", payload.tariff.tarife_turu || "—"],
      ["Rezerv abone", payload.tariff.abone_sayisi],
      ["UAVT", payload.tariff.building_uavt || "—"]
    );
  }

  coverRows.push([""], ["Alan", "Değer"], ...summaryRows(payload));

  const ozetSheet = XLSX.utils.aoa_to_sheet(coverRows);
  setColumnWidths(ozetSheet, [28, 48]);
  XLSX.utils.book_append_sheet(wb, ozetSheet, "Kapak");

  const sayacSheet = XLSX.utils.json_to_sheet(
    payload.meters.map((m) => ({
      "Birim No": m.birim_no,
      Blok: m.blok_no,
      Kat: m.kat,
      "Kapı No": m.kapi_no,
      Oda: m.oda_sayisi,
      Kullanım: m.kullanilis_sekli,
      "Sayaç No": m.sayac_id,
      "Abone No": m.abone_no,
      Sicil: m.sicil_no,
      Marka: m.sayac_markasi,
      Durum: m.durum_etiket,
      Güncelleme: m.updated_at || "",
    }))
  );
  setColumnWidths(sayacSheet, [10, 14, 14, 10, 8, 14, 14, 14, 12, 10, 18]);
  XLSX.utils.book_append_sheet(wb, sayacSheet, "Sayaçlar");

  if (payload.rezerv_abonelikler.length > 0) {
    const rezervSheet = XLSX.utils.json_to_sheet(
      payload.rezerv_abonelikler.map((r) => ({
        "Abone No": r.abone_no,
        "Sayaç No": r.sayac_no,
        "Tarife Türü": r.tarife_turu,
        "Tarife Sınıfı": r.tarife_sinif,
        UAVT: r.building_uavt,
      }))
    );
    setColumnWidths(rezervSheet, [14, 14, 36, 16, 16]);
    XLSX.utils.book_append_sheet(wb, rezervSheet, "Rezerv Abonelik");
  }

  if (payload.islem_gecmisi.length > 0) {
    const logSheet = XLSX.utils.json_to_sheet(
      payload.islem_gecmisi.map((log) => ({
        Tarih: formatDate(log.created_at),
        Kullanıcı: log.user_email,
        İşlem: log.action,
        Özet: log.summary,
      }))
    );
    setColumnWidths(logSheet, [22, 28, 12, 60]);
    XLSX.utils.book_append_sheet(wb, logSheet, "İşlem Geçmişi");
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
