import path from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const DB_PATH = path.join(process.cwd(), "data", "binalar.db");
export const BACKUP_DIR = path.join(process.cwd(), "data", "backups");
export const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
export const HISTORY_PATH = path.join(process.cwd(), "data", "import-history.json");

export interface ImportHistoryEntry {
  id: string;
  timestamp: string;
  filename: string;
  backupPath: string;
  uploadPath?: string;
  stats: Record<string, number>;
  rowCount: number;
}

export interface ImportHistory {
  last: ImportHistoryEntry | null;
}

export function openDb(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA busy_timeout = 15000");
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN sayac_durum TEXT DEFAULT 'gecerli'`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN abone_no TEXT DEFAULT ''`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN sicil_no TEXT DEFAULT ''`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN kat TEXT DEFAULT ''`);
  } catch {
    /* exists */
  }
  return db;
}

export function ensureDirs() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function loadHistory(): ImportHistory {
  try {
    if (!existsSync(HISTORY_PATH)) return { last: null };
    return JSON.parse(readFileSync(HISTORY_PATH, "utf8")) as ImportHistory;
  } catch {
    return { last: null };
  }
}

export function saveHistory(history: ImportHistory) {
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

export function createBackup(): string {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = path.join(BACKUP_DIR, `binalar.before-import-${stamp}.db`);
  copyFileSync(DB_PATH, backupPath);
  return backupPath;
}

export function savePendingUpload(buffer: Buffer, filename: string): { id: string; uploadPath: string } {
  ensureDirs();
  const id = randomUUID();
  const safeName = filename.replace(/[^\w.\-() ]+/g, "_").slice(0, 80);
  const uploadPath = path.join(UPLOAD_DIR, `pending-${id}-${safeName}`);
  writeFileSync(uploadPath, buffer);
  return { id, uploadPath };
}

export function getPendingUpload(id: string): string | null {
  if (!existsSync(UPLOAD_DIR)) return null;
  const files = readdirSync(UPLOAD_DIR);
  const hit = files.find((f) => f.startsWith(`pending-${id}-`));
  return hit ? path.join(UPLOAD_DIR, hit) : null;
}

export function removePendingUpload(uploadPath?: string) {
  if (uploadPath && existsSync(uploadPath)) {
    try {
      unlinkSync(uploadPath);
    } catch {
      /* ignore */
    }
  }
}

export function rollbackLastImport(): { ok: boolean; message: string } {
  const history = loadHistory();
  if (!history.last?.backupPath || !existsSync(history.last.backupPath)) {
    return { ok: false, message: "Geri alınacak yedek bulunamadı." };
  }

  copyFileSync(history.last.backupPath, DB_PATH);
  removePendingUpload(history.last.uploadPath);
  saveHistory({ last: null });

  return {
    ok: true,
    message: `Son aktarım geri alındı (${history.last.filename}, ${new Date(history.last.timestamp).toLocaleString("tr-TR")}).`,
  };
}
