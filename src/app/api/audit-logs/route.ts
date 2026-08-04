import { NextRequest, NextResponse } from "next/server";
import { ensureAuthSchema, requireRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const action = (searchParams.get("action") || "").trim();
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 500);
  const db = ensureAuthSchema();

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (q) {
    clauses.push("(user_email LIKE ? OR summary LIKE ? OR entity LIKE ? OR entity_id LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (action) {
    clauses.push("action = ?");
    params.push(action);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const logs = db
    .prepare(
      `SELECT id, user_id, user_email, user_role, action, entity, entity_id, summary,
              before_json, after_json, metadata_json, ip, success, created_at
       FROM audit_logs ${where}
       ORDER BY id DESC LIMIT ?`
    )
    .all(...params, limit);
  return NextResponse.json({ logs });
}
