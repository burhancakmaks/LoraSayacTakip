import { NextRequest, NextResponse } from "next/server";
import { getBildirimDb, seedBildirimlerIfEmpty } from "@/lib/bildirim";
import { requireRole, writeAudit } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const since = searchParams.get("since");
    const limit = Math.min(parseInt(searchParams.get("limit") || "30", 10), 100);
    const onlyUnread = searchParams.get("unread") === "1";

    const db = getBildirimDb();
    seedBildirimlerIfEmpty(db);

    let query = `
      SELECT id, tip, baslik, mesaj, bina_id, birim_no, okundu, created_at
      FROM bildirim
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (since) {
      // ISO veya SQLite formatını datetime() ile karşılaştır
      const sinceNorm = since.includes("T") ? since.slice(0, 19).replace("T", " ") : since;
      query += ` AND datetime(created_at) > datetime(?)`;
      params.push(sinceNorm);
    }
    if (onlyUnread) {
      query += ` AND okundu = 0`;
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const items = db.prepare(query).all(...params);
    const unread = (db.prepare(`SELECT COUNT(*) AS c FROM bildirim WHERE okundu = 0`).get() as { c: number }).c;

    return NextResponse.json({ items, unread });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bildirim hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRole(request, "viewer");
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const db = getBildirimDb();

    if (body.all) {
      db.prepare(`UPDATE bildirim SET okundu = 1 WHERE okundu = 0`).run();
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      const placeholders = body.ids.map(() => "?").join(",");
      db.prepare(`UPDATE bildirim SET okundu = 1 WHERE id IN (${placeholders})`).run(...body.ids);
    }

    const unread = (db.prepare(`SELECT COUNT(*) AS c FROM bildirim WHERE okundu = 0`).get() as { c: number }).c;
    writeAudit(request, auth.user, {
      action: "read",
      entity: "bildirim",
      summary: body.all ? "Tüm bildirimler okundu olarak işaretlendi" : `${body.ids?.length || 0} bildirim okundu`,
      metadata: body.all ? { all: true } : { ids: body.ids },
    });
    return NextResponse.json({ success: true, unread });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Güncelleme hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
