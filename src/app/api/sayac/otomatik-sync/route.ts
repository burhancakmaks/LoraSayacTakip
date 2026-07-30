import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const STATE_PATH = path.join(process.cwd(), "data", "sync-state.json");
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "sayac-otomatik-sync.mjs");

function loadState() {
  try {
    if (!existsSync(STATE_PATH)) return null;
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const state = loadState();
    return NextResponse.json({
      enabled: true,
      last_sync: state?.last_sync ?? null,
      files: state?.files ?? {},
      last_stats: state?.last_stats ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Durum okunamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = body?.force === true;

    const { stdout } = await execFileAsync(process.execPath, [SCRIPT_PATH, ...(force ? ["--force"] : [])], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const result = JSON.parse(stdout.trim());
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Senkron hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
