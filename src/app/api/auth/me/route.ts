import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasUsers } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getSessionFromRequest(request);
  return NextResponse.json({ user, configured: hasUsers() });
}
