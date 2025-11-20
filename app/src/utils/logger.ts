// app/utils/logger.ts
import * as FileSystem from "expo-file-system";

/**
 * Folder untuk file log:
 * - pakai cacheDirectory kalau ada
 * - kalau nggak ada, fallback ke documentDirectory
 */
const LOG_DIR: string | null =
  // pakai "as any" biar TypeScript nggak rewel di beberapa versi expo-file-system
  (FileSystem as any).cacheDirectory ??
  (FileSystem as any).documentDirectory ??
  null;

/** Path file log (null kalau tidak ada direktori yang tersedia) */
export const LOG_FILE_PATH: string | null = LOG_DIR
  ? `${LOG_DIR}absen-log.txt`
  : null;

/** Timestamp sederhana: 2025-11-20 14:03:12 */
function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Stringify data dengan aman (hindari error circular JSON) */
function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/** Tulis satu baris ke file log, dengan batas ukuran ±200 KB */
async function writeline(line: string): Promise<void> {
  if (!LOG_FILE_PATH) {
    // kalau nggak ada direktori, fallback ke console aja
    console.log(line);
    return;
  }

  try {
    const info = (await FileSystem.getInfoAsync(LOG_FILE_PATH)) as { exists: boolean; size?: number };

    // keep tail ~200KB terakhir
    const MAX = 200 * 1024;
    let prev = "";
    if (info.exists && typeof info.size === "number" && info.size < MAX) {
      prev = await FileSystem.readAsStringAsync(LOG_FILE_PATH);
    }

    const next = `${prev}${line}\n`;
    const trimmed = next.length > MAX ? next.slice(next.length - MAX) : next;

    await FileSystem.writeAsStringAsync(LOG_FILE_PATH, trimmed);
  } catch (e) {
    // jangan sampe logger-nya bikin crash, cukup console.log
    console.log("logger.writeline error", e);
  }
}

/** Log INFO ke console + file */
export async function logInfo(tag: string, data?: unknown): Promise<void> {
  const msg = data === undefined ? "" : safeStringify(data);
  console.log(`[INFO][${tag}]`, data);
  await writeline(`[${ts()}][INFO][${tag}] ${msg}`);
}

/** Log ERROR ke console + file (boleh kirim err + extra) */
export async function logError(tag: string, err?: unknown, extra?: unknown): Promise<void> {
  const payload = extra !== undefined ? { err, extra } : err;
  const msg = payload === undefined ? "" : safeStringify(payload);
  console.log(`[ERROR][${tag}]`, payload);
  await writeline(`[${ts()}][ERROR][${tag}] ${msg}`);
}
