import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";

// biar TS nggak ribut
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const global: any;

// ==== Lokasi file log ====
const LOG_DIR: string | null =
  (FileSystem as any).cacheDirectory ??
  (FileSystem as any).documentDirectory ??
  null;

// file log utama
export const LOG_FILE_PATH: string | null = LOG_DIR
  ? `${LOG_DIR}absen-log.txt`
  : null;

function ts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// tulis 1 baris ke file, jaga ukuran max ~200KB
async function appendLine(line: string) {
  try {
    if (!LOG_FILE_PATH) return;

    const info = await FileSystem.getInfoAsync(LOG_FILE_PATH);
    let prev = "";
    if ((info as any).exists) {
      prev = await FileSystem.readAsStringAsync(LOG_FILE_PATH);
    }

    const next = prev + line + "\n";
    const MAX = 200 * 1024;
    const trimmed = next.length > MAX ? next.slice(next.length - MAX) : next;

    await FileSystem.writeAsStringAsync(LOG_FILE_PATH, trimmed);
  } catch {
    // jangan sampai logging bikin crash
  }
}

type Level = "INFO" | "WARN" | "ERROR";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeStringify(data: any): string {
  if (data === undefined) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function write(level: Level, tag: string, data?: any) {
  const msg = safeStringify(data);
  const line = `[${ts()}][${level}][${tag}] ${msg}`;

  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }

  await appendLine(line);
}

export function getLogFileUri(): string | null {
  return LOG_FILE_PATH;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logInfo(tag: string, data?: any) {
  await write("INFO", tag, data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logWarn(tag: string, data?: any) {
  await write("WARN", tag, data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logError(tag: string, data?: any) {
  await write("ERROR", tag, data);
}

// ==== Global error handler (optional, supaya error fatal ikut masuk log) ====

let globalInstalled = false;

export function installGlobalErrorHandler() {
  if (globalInstalled) return;
  globalInstalled = true;

  const ErrorUtilsAny = global?.ErrorUtils;
  if (!ErrorUtilsAny || typeof ErrorUtilsAny.setGlobalHandler !== "function") {
    return;
  }

  const defaultHandler =
    typeof ErrorUtilsAny.getGlobalHandler === "function"
      ? ErrorUtilsAny.getGlobalHandler()
      : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ErrorUtilsAny.setGlobalHandler(async (err: any, isFatal?: boolean) => {
    try {
      await logError("GLOBAL", {
        message: String(err?.message || err),
        stack: err?.stack ?? null,
        isFatal: !!isFatal,
        platform: Platform.OS,
      });
    } catch {
      // ignore
    }

    if (typeof defaultHandler === "function") {
      defaultHandler(err, isFatal);
    }
  });
}
