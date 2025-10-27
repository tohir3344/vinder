// services/attendance.ts
import { API_BASE } from "../app/config";

/* ========= Types ========= */
export type StatusKey = "HADIR" | "IZIN" | "SAKIT" | "ALPHA";
export interface ApiResult { success: boolean; message?: string }

export interface AdminUpsertPayload {
  mode: "create" | "update";
  id?: number;
  user_id: number;
  tanggal: string;             // YYYY-MM-DD
  jam_masuk?: string | null;   // HH:MM:SS
  jam_keluar?: string | null;  // HH:MM:SS
  status: StatusKey;
  alasan?: string | null;
}

export type AbsenRow = {
  id: number;
  user_id: number;
  nama: string;
  email: string;
  tanggal: string;          // YYYY-MM-DD
  jam_masuk?: string | null;
  jam_keluar?: string | null;
  keterangan: StatusKey | string;  // (server bisa kirim string)
  alasan?: string | null;
  masuk_lat?: string | null;
  masuk_lng?: string | null;
  keluar_lat?: string | null;
  keluar_lng?: string | null;
  foto_masuk?: string | null;
  foto_keluar?: string | null;
};

export type Totals = { hadir: number; izin: number; sakit: number; alpha: number };

/* ========= Base & helpers ========= */
const BASE = API_BASE.replace(/\/+$/, ""); // strip trailing slash

// kalau API_BASE sudah mengandung "/api", pakai langsung; kalau belum, tambahkan "/api"
function endpoint(path: string) {
  const hasApi = /(^|\/)api(\/|$)/.test(BASE);
  return hasApi ? `${BASE}/absen/${path}` : `${BASE}/api/absen/${path}`;
}

function joinUrlWithQuery(url: string, qs: Record<string, unknown>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && String(v) !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Not JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

/* ========= Services ========= */
export async function getHistory(params: {
  q?: string; start?: string; end?: string; limit?: number;
}): Promise<AbsenRow[]> {
  const url = joinUrlWithQuery(endpoint("get_history.php"), {
    q: params.q,
    start: params.start,
    end: params.end,
    limit: params.limit ?? 300,
  });

  const resp = await fetch(url);
  const json = await parseJsonOrThrow<{ success: boolean; data: AbsenRow[]; message?: string }>(resp);
  if (!json.success) throw new Error(json.message || "get_history failed");
  return json.data ?? [];
}

export async function getSummary(range: "week" | "month"): Promise<{
  success: true;
  range: string;
  start?: string;
  end?: string;
  totals: Totals;
  daily?: ({ tanggal: string } & Totals)[];
}> {
  const url = joinUrlWithQuery(endpoint("get_summary.php"), { range });
  const resp = await fetch(url);
  const json = await parseJsonOrThrow<{
    success: boolean;
    range: string;
    start?: string;
    end?: string;
    totals: Totals;
    daily?: ({ tanggal: string } & Totals)[];
    message?: string;
  }>(resp);
  if (!json.success) throw new Error(json.message || "get_summary failed");
  return json as any;
}

export async function adminUpsert(payload: AdminUpsertPayload): Promise<ApiResult> {
  // gunakan helper endpoint() supaya kompatibel baik BASE berakhiran /api maupun tidak
  const url = endpoint("admin_upsert.php");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJsonOrThrow<ApiResult>(resp);
  return json;
}
