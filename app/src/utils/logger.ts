// app/utils/logger.ts
import {
  cacheDirectory,
  documentDirectory,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system";
import * as Sharing from "expo-sharing";

// ==== Lokasi file log ====
// Ambil yang tersedia: cacheDirectory -> documentDirectory -> fallback "file:///"
const BASE_DIR = cacheDirectory ?? documentDirectory ?? "file:///";
export const LOG_FILE = `${BASE_DIR}absen-log.txt`;

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function safeStringify(v: unknown) {
  try {
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  } catch {
    try {
      return String(v);
    } catch {
      return "[Unserializable]";
    }
  }
}

// Simpan 1 baris ke file, keep last ~200KB saja
async function writeline(line: string) {
  try {
    const info = await getInfoAsync(LOG_FILE);
    const prev = info.exists ? await readAsStringAsync(LOG_FILE) : "";
    const next = prev ? `${prev}\n${line}` : line;

    const MAX = 200 * 1024; // 200KB (UTF-8 kurang lebih)
    const trimmed = next.length > MAX ? next.slice(next.length - MAX) : next;

    await writeAsStringAsync(LOG_FILE, trimmed);
  } catch {
    // abaikan error logger agar tidak mengganggu alur app
  }
}

/** Log info umum (juga ke console) */
export async function log(tag: string, data?: unknown) {
  const line = `[${ts()}][${tag}] ${safeStringify(data)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  await writeline(line);
}

/** Log error + stack trace (kalau ada) */
export async function logError(tag: string, err: unknown) {
  const msg =
    err instanceof Error
      ? `${err.message}\n${err.stack ?? ""}`.trim()
      : safeStringify(err);
  await log(`ERR:${tag}`, msg);
}

/** Baca seluruh isi log sebagai string (jika gagal, return "") */
export async function readLog() {
  try {
    return await readAsStringAsync(LOG_FILE);
  } catch {
    return "";
  }
}

/** Kosongkan isi log */
export async function clearLog() {
  try {
    await writeAsStringAsync(LOG_FILE, "");
  } catch {
    // ignore
  }
}

/** (Opsional) pasang global handler supaya JS error otomatis masuk log */
let installed = false;
// `global.ErrorUtils` tersedia di RN
declare const global: any;
export function installGlobalErrorLogger() {
  if (installed) return;
  installed = true;

  const ErrorUtils = global?.ErrorUtils;
  const prev = ErrorUtils?.getGlobalHandler?.();

  ErrorUtils?.setGlobalHandler?.((e: any, isFatal?: boolean) => {
    const text =
      (e?.stack as string) ||
      (e?.message as string) ||
      safeStringify(e) ||
      "[unknown error]";
    void writeline(`[${ts()}][JS_FATAL:${isFatal ? 1 : 0}] ${text}`);
    // teruskan ke handler default supaya RedBox/Crash tetap muncul saat dev
    prev?.(e, isFatal);
  });
}

/** (Opsional) share file log via menu share */
export async function shareLog() {
  try {
    const ok = await Sharing.isAvailableAsync();
    if (!ok) return false;
    await Sharing.shareAsync(LOG_FILE);
    return true;
  } catch {
    return false;
  }
}
