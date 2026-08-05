import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { jsPDF } from "jspdf";

export const PDF_FONT = "DejaVuSans";

let fontsRegistered = false;

function loadFontBase64(filename: string) {
  const fontPath = join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf", filename);
  return readFileSync(fontPath).toString("base64");
}

export function registerTurkishPdfFont(doc: jsPDF) {
  if (!fontsRegistered) {
    doc.addFileToVFS("DejaVuSans.ttf", loadFontBase64("DejaVuSans.ttf"));
    doc.addFont("DejaVuSans.ttf", PDF_FONT, "normal");

    doc.addFileToVFS("DejaVuSans-Bold.ttf", loadFontBase64("DejaVuSans-Bold.ttf"));
    doc.addFont("DejaVuSans-Bold.ttf", PDF_FONT, "bold");

    fontsRegistered = true;
  }

  doc.setFont(PDF_FONT, "normal");
  return PDF_FONT;
}
