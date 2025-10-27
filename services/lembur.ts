// services/lembur.ts
import { API_BASE } from "../app/config";

export type LemburRow = {
  id: number;
  user_id: number;
  nama?: string;
  tanggal: string;
  jam_masuk?: string | null;
  jam_keluar?: string | null;
  alasan?: string | null;
  total_menit: number;     // basis menit
  total_jam: number;     // basis menit
  total_upah: number;      // dihitung server
};

export type LemburSummary = {
  jam_minggu?: number;      // opsional (fallback ke floor menit/60 kalau undefined)
  menit_minggu: number;    // total menit 7 hari terakhir
  upah_minggu: number;     // total upah 7 hari terakhir
  rate: number;            // info tarif per jam
};

type LemburListResponse = {
  success: boolean;
  count: number;
  data: LemburRow[];
  summary: LemburSummary;
  message?: string;
};

// base url helper (support API_BASE dengan/ tanpa /api)
function stripTrailingSlash(s: string) { return s.replace(/\/+$/, ""); }
const BASE = stripTrailingSlash(API_BASE);
function endpoint(path: string) {
  const hasApi = /(^|\/)api(\/|$)/.test(BASE);
  return hasApi ? `${BASE}/lembur/${path}` : `${BASE}/api/lembur/${path}`;
}
function joinUrlWithQuery(url: string, qs: Record<string, unknown>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && String(v) !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export async function getLemburList(params: {
  user_id: number; start?: string; end?: string; limit?: number;
}): Promise<LemburListResponse> {
  const url = joinUrlWithQuery(endpoint("get_list.php"), {
    user_id: params.user_id,
    start: params.start,
    end: params.end,
    limit: params.limit ?? 200,
  });
  const resp = await fetch(url);
  const text = await resp.text();
  try {
    const json = JSON.parse(text) as LemburListResponse;
    if (!json.success) throw new Error(json.message || "API error");
    return json;
  } catch {
    throw new Error(`LEMBUR_LIST not JSON: ${text.slice(0, 200)}`);
  }
}
