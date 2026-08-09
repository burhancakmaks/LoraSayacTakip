import { NextRequest, NextResponse } from "next/server";
import { getDiskapiDoorForBina } from "@/lib/diskapi-lookup";

// GET /api/diskapi/location?bina_id=1&kapi_no=70/1
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const binaId = parseInt(searchParams.get("bina_id") || "", 10);
    if (!binaId) {
      return NextResponse.json({ error: "bina_id gerekli" }, { status: 400 });
    }

    const kapiNo = (searchParams.get("kapi_no") || "").trim();
    const door = getDiskapiDoorForBina(binaId, kapiNo || undefined);
    if (!door) {
      return NextResponse.json({ error: "Kapı konumu bulunamadı" }, { status: 404 });
    }

    return NextResponse.json({
      bina_id: binaId,
      kapi_no: door.kapi_no,
      lat: door.lat,
      lng: door.lng,
      alignment: door.alignment,
      edge_distance_m: door.edge_distance_m,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Kapı konumu hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
