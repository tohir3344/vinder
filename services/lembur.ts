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
  total_menit: number;
  total_jam: number;
  total_upah: number;

  // 🔥 TAMBAHKAN INI AGAR TYPESCRIPT TIDAK BINGUNG
  jenis_lembur?: string;
};

export type LemburSummary = {
  jam_minggu?: number;
  menit_minggu: number;
  upah_minggu: number;
  rate: number;
};

type LemburListResponse = {
  success: boolean;
  count?: number; // Bikin opsional
  data: LemburRow[];
  summary?: LemburSummary; // Bikin opsional
  message?: string;
};

// ... (Bagian helper url biarkan saja) ...
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

  // 🔥 PASTIKAN NAMA FILE PHP DISINI SAMA DENGAN FILE PHP KAMU
  // Kalau nama file php kamu "lembur_list.php", ganti string di bawah ini:
  const url = joinUrlWithQuery(endpoint("get_list.php"), {
    action: 'list', // Tambahkan parameter action eksplisit biar aman
    user_id: params.user_id,
    start: params.start,
    end: params.end,
    limit: params.limit ?? 200,
  });

  const resp = await fetch(url);
  const text = await resp.text();
  try {
    const json = JSON.parse(text); // Jangan cast dulu biar fleksibel

    // 🔥 HANDLING JIKA PHP MENGIRIM FORMAT LAMA 'rows'
    if (json.rows && !json.data) {
      json.data = json.rows;
      json.success = true;
    }

    if (!json.success && !json.rows) throw new Error(json.message || "API error");

    return {
      success: true,
      count: json.data?.length || 0,
      data: json.data || [],
      summary: json.summary || { menit_minggu: 0, upah_minggu: 0, rate: 0 }
    };
  } catch (e: any) {
    throw new Error(`LEMBUR_LIST Error: ${e.message} | Raw: ${text.slice(0, 100)}`);
  }
}