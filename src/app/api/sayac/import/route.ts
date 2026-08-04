import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadHistory } from "@/lib/sayac-import-store";

export async function GET() {
  try {
    const history = loadHistory();
    const templatePath = path.join(process.cwd(), "public", "templates", "sayac-aktarim-sablonu.xlsx");
    return NextResponse.json({
      templateAvailable: existsSync(templatePath),
      templateUrl: "/templates/sayac-aktarim-sablonu.xlsx",
      lastImport: history.last,
      canRollback: Boolean(history.last?.backupPath && existsSync(history.last.backupPath)),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Durum okunamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
