import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { searchSayaclar } from "@/lib/sayac-search";

function getDb() {
  const dbPath = path.join(process.cwd(), "data", "binalar.db");
  return new DatabaseSync(dbPath, { readOnly: true });
}

// GET /api/sayac/search?q=02995735
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    if (!q || q.length < 3) {
      return NextResponse.json([]);
    }

    const db = getDb();
    const results = searchSayaclar(db, q, 40);
    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Arama hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
