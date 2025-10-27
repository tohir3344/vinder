import { Platform } from "react-native";
import Constants from "expo-constants";

/** Hilangkan scheme (exp://, http://, https://) dan path, sisakan host:port */
function stripSchemeAndPath(raw: string): string {
  let s = raw.trim();
  // buang scheme
  s = s.replace(/^([a-z]+):\/\//i, "");   // exp://, http://, https://
  // ambil sebelum first slash
  const idx = s.indexOf("/");
  if (idx >= 0) s = s.slice(0, idx);
  return s;
}

/** Ambil host dev server dari Expo (support SDK lama & baru) */
function getDevHost(): string | null {
  const hostUri = (Constants as any)?.expoConfig?.hostUri;                // "192.168.1.10:8081"
  const dbgHost = (Constants as any)?.manifest?.debuggerHost;             // "192.168.1.10:19000"
  const m2Host  = (Constants as any)?.manifest2?.extra?.expoClient?.hostUri; // "exp://192.168.1.10:8081"

  const raw = hostUri || dbgHost || m2Host;
  if (!raw) return null;

  const hostPort = stripSchemeAndPath(String(raw));  // "192.168.1.10:8081"
  let host = hostPort;

  // buang port (IPv6 jarang dipakai di LAN dev; kalau ada, akan dalam [::1])
  if (host.includes(":") && !host.startsWith("[")) {
    host = host.split(":")[0];
  }

  // fallback aman
  if (!host || host === "localhost" || host === "127.0.0.1") {
    if (Platform.OS === "android") return "10.0.2.2"; // emulator
    return "localhost"; // iOS simulator
  }
  return host;
}

/** Build base URL dev (Expo Go / emulator / simulator) – SELALU akhiri dengan "/" */
function getDevBase(): string {
  // izinkan override manual kalau perlu
  const envHost = process.env.EXPO_PUBLIC_DEV_HOST; // contoh "192.168.1.10"
  let host = (envHost && envHost.trim()) || getDevHost() || "localhost";

  if ((host === "localhost" || host === "127.0.0.1") && Platform.OS === "android") {
    host = "10.0.2.2";
  }

  // PENTING: akhiri dengan "/"
  return `http://${host}/penggajian/api/`;
}

/**
 * PRODUKSI: set via app.json/eas.json:
 *  "extra": { "EXPO_PUBLIC_API_BASE": "https://api.domainmu.com/penggajian/api/" }
 * (akhiri dengan "/")
 */
const PROD_BASE =
  (process.env.EXPO_PUBLIC_API_BASE || "").trim() || "http://example.com/penggajian/api/"; // ← ganti saat release

export const API_BASE = (__DEV__ ? getDevBase() : PROD_BASE);

// debug kecil (hapus kalau sudah aman)
if (__DEV__) {
  console.log("[API_BASE]", API_BASE);
}
