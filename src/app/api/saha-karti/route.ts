import { NextRequest, NextResponse } from "next/server";
import { requireRole, writeAudit } from "@/lib/auth";
import { buildSahaKartiFilename, loadSahaKartiData } from "@/lib/saha-karti-data";
import { buildSahaKartiExcel, buildSahaKartiPdf } from "@/lib/saha-karti-export";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "viewer");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const binaIdRaw = searchParams.get("bina_id");
  const format = (searchParams.get("format") || "pdf").toLowerCase();
  const aboneNo = searchParams.get("abone_no");
  const sayacId = searchParams.get("sayac_id");

  if (!binaIdRaw) {
    return NextResponse.json({ error: "bina_id gerekli" }, { status: 400 });
  }

  const binaId = Number.parseInt(binaIdRaw, 10);
  if (!Number.isFinite(binaId)) {
    return NextResponse.json({ error: "Geçersiz bina_id" }, { status: 400 });
  }

  if (format !== "pdf" && format !== "xlsx") {
    return NextResponse.json({ error: "format pdf veya xlsx olmalı" }, { status: 400 });
  }

  try {
    const payload = loadSahaKartiData(binaId, {
      abone_no: aboneNo,
      sayac_id: sayacId,
    });

    const filename = buildSahaKartiFilename(payload, format);
    const buffer =
      format === "pdf" ? buildSahaKartiPdf(payload) : buildSahaKartiExcel(payload);

    writeAudit(request, auth.user, {
      action: "export",
      entity: "saha_karti",
      entityId: binaId,
      summary: `${payload.building_name} için saha kartı ${format.toUpperCase()} çıktısı alındı`,
      metadata: {
        format,
        meter_count: payload.meters.length,
        abone_no: payload.filter.abone_no,
        sayac_id: payload.filter.sayac_id,
      },
    });

    const contentType =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Encoding": "identity",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Saha kartı oluşturulamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
