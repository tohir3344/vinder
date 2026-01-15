// app/admin/LemburAdmin.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import type { ListRenderItem } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { API_BASE as RAW_API_BASE } from "../../config";

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";

/** ===== Types ===== */
type LemburRow = {
  id: number;
  user_id: number;
  nama: string;
  tanggal: string;
  jam_masuk: string;
  jam_keluar: string;

  alasan: string;
  alasan_keluar: string;
  jenis_lembur?: string;
  status?: string;

  total_menit?: number;
  total_menit_masuk?: number | null;
  total_menit_keluar?: number | null;
  total_jam?: string;
  total_upah?: number | null;

  // 🔥 FIELD BARU: Rate per jam dari user
  rate_per_jam?: number;
};

type PerUser = { 
  user_id: number; 
  nama: string; 
  menit: number; 
  jamStr: string; 
  upah: number 
};

type UserLite = { id: number; username: string; nama: string };

/** ===== Endpoint ===== */
const API_LIST = `${API_BASE}lembur/lembur_list.php`;
const API_CONFIG = `${API_BASE}lembur/lembur_list.php?action=config`;

/** ===== Utils HTTP ===== */
async function fetchText(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, statusText: res.statusText, text };
}
async function parseJSON(text: string) {
  try { return JSON.parse(text); } catch { throw new Error(`Response bukan JSON:\n${text}`); }
}

/** ===== Waktu & Uang ===== */
function toMinutes(hhmm: string): number | null {
  if (!hhmm) return null;
  const p = hhmm.trim().split(":");
  if (p.length < 2) return null;
  const h = parseInt(p[0], 10);
  const m = parseInt(p[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function hhmmFromMinutes(total: number) {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
function formatIDR(n: number) { return Math.round(n).toLocaleString("id-ID"); }
const pickServerOr = (val: any, fallback: number) => {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

type TimeField = "jam_masuk" | "jam_keluar";
type DateField = "filter_start" | "filter_end" | "form_tanggal";

/** ===== Helper tanggal ===== */
const pad2 = (x: number) => String(x).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function getSaturday(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 1) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function getWeekRangeByOffset(offset: number) {
  const today = new Date();
  const thisSat = getSaturday(today);
  const start = addDays(thisSat, -7 * offset);
  const end = addDays(start, 6);
  return { start, end, startStr: toYmd(start), endStr: toYmd(end) };
}

const monthNamesId = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function getMonthRangeByOffset(offset: number) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const base = new Date(y, m - offset, 1);
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999);
  return {
    start, end,
    startStr: toYmd(start),
    endStr: toYmd(end),
    label: `${monthNamesId[start.getMonth()]} ${start.getFullYear()}`
  };
}

/** ===== PDF helpers ===== */
const buildPdfHtml = (
  title: string,
  rangeLabel: string,
  rows: LemburRow[],
  _ratePerMenit: number
) => {
  const company = "PT. PORDJO STEELINDO PERKASA";
  const fmtTime = (s?: string) => (s ? String(s).slice(0, 5) : "-");
  const esc = (x: any) =>
    String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

  const tableRows = rows
    .map((r, i) => {
      const nama = r.nama ?? "";
      const totalJam = r.total_jam ?? "-";
      const alasanMasuk = (r.alasan && r.alasan.trim().length > 0) ? r.alasan : "-";
      const alasanKeluar = (r.alasan_keluar && r.alasan_keluar.trim().length > 0) ? r.alasan_keluar : "-";
      const upahRp = formatIDR(r.total_upah ?? 0);
      const rateJam = formatIDR(r.rate_per_jam ?? 0);

      const jenis = r.jenis_lembur === 'over' ? "LANJUTAN" : "BIASA";
      const x2Label = r.jenis_lembur === 'over' ? "<br/><span style='color:green;font-size:8px;'>(x2)</span>" : "";

      return `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="c">${esc(r.tanggal ?? "")}</td>
        <td>${esc(nama)}</td>
        <td class="c">${fmtTime(r.jam_masuk)}</td>
        <td class="c">${fmtTime(r.jam_keluar)}</td>
        <td class="c">${esc(totalJam)}</td>
        <td class="r">Rp ${rateJam} ${x2Label}</td>
        <td class="r">Rp ${upahRp}</td>
        <td class="c" style="font-size:9px;">${esc(jenis)}</td>
        <td class="l">${esc(alasanMasuk)}</td>
        <td class="l">${esc(alasanKeluar)}</td>
      </tr>`;
    })
    .join("");

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Surat Perintah Lembur</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color:#111; margin: 0; padding: 0; }
  .wrap { padding: 20px; width: 100%; }
  .header { text-align:center; margin-bottom:15px; border-bottom: 2px solid #333; padding-bottom: 10px; }
  .header .title { font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
  .header .company { font-size: 12px; font-weight: 600; margin-top: 4px; }
  .header .meta { font-size: 10px; color:#555; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #444; padding: 4px 5px; font-size: 10px; word-wrap: break-word; overflow-wrap: break-word; }
  th { background:#f0f0f0; font-weight:700; text-transform: uppercase; }
  .c { text-align:center; }
  .r { text-align:right; }
  .l { text-align:left; }
  .col-no { width: 4%; }
  .col-tgl { width: 9%; }
  .col-nama { width: 15%; }
  .col-jam { width: 6%; }
  .col-dur { width: 6%; }
  .col-rate { width: 8%; }
  .col-rp  { width: 9%; }
  .col-jns { width: 6%; }
  .col-als { width: 15%; }
  .note { margin-top: 15px; font-size: 9px; color: #444; }
  .sign { margin-top: 30px; display:flex; justify-content:flex-end; }
  .sign .box { width: 180px; text-align:center; font-size: 10px; }
  .sign .line { margin-top: 50px; border-top:1px solid #000; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="title">Surat Perintah Lembur</div>
      <div class="company">${esc(company)}</div>
      ${rangeLabel ? `<div class="meta">${esc(rangeLabel)}</div>` : ``}
    </div>
    <table>
      <thead>
        <tr>
          <th class="col-no">No</th>
          <th class="col-tgl">Tanggal</th>
          <th class="col-nama">Nama</th>
          <th class="col-jam">In</th>
          <th class="col-jam">Out</th>
          <th class="col-dur">Jam</th>
          <th class="col-rate">Upah/Jam</th>
          <th class="col-rp">Total</th>
          <th class="col-jns">Jenis</th>
          <th class="col-als">Alasan Masuk</th>
          <th class="col-als">Alasan Keluar</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows || `<tr><td class="c" colspan="11">Tidak ada data</td></tr>`}
      </tbody>
    </table>
    <div class="note">
      <b>NOTE:</b><br/>
      1. Data di-generate otomatis dari sistem absensi.<br/>
      2. Harap simpan dokumen ini sebagai bukti lembur.
    </div>
    <div class="sign">
      <div class="box">
        <div>Disetujui Oleh,</div>
        <div class="line"><b>( Paraf Atasan )</b></div>
      </div>
    </div>
  </div>
</body>
</html>`;
};

async function exportRowsToPdf(title: string, rangeLabel: string, list: LemburRow[], ratePerMenit: number) {
  if (!list.length) { Alert.alert("PDF", "Tidak ada data untuk dicetak."); return; }
  const html = buildPdfHtml(title, rangeLabel, list, ratePerMenit);
  try {
    const file = await Print.printToFileAsync({ html, base64: false });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { dialogTitle: title });
    } else {
      Alert.alert("PDF Tersimpan", file.uri);
    }
  } catch (error: any) {
    Alert.alert("Gagal Cetak", error.message);
  }
}

/** ===== Screen ===== */
export default function LemburAdmin() {
  const [rows, setRows] = useState<LemburRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [cutIn, setCutIn] = useState("08:00");
  const [cutOut, setCutOut] = useState("17:00");
  
  // 🔥 Default rate global dipasang 0 agar prioritas ke database per user
  const [ratePerMenit, setRatePerMenit] = useState<number>(0);

  const [tab, setTab] = useState<"data" | "weekly" | "monthly">("data");

  const [weekOffset, setWeekOffset] = useState<number>(1);
  const [monthOffset, setMonthOffset] = useState<number>(0);

  const [q, setQ] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [applied, setApplied] = useState<{ q: string; start?: string; end?: string }>({ q: "" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoApply = useCallback((next: { q?: string; start?: string; end?: string }) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setApplied((prev) => ({
        q: next.q ?? prev.q,
        start: next.start ?? prev.start,
        end: next.end ?? prev.end,
      }));
    }, 250);
  }, []);

  useEffect(() => { autoApply({ q }); }, [q, autoApply]);
  useEffect(() => { autoApply({ start }); }, [start, autoApply]);
  useEffect(() => { autoApply({ end }); }, [end, autoApply]);

  const computeOvertimeParts = useCallback((jamMasuk: string, jamKeluar: string) => {
    const inMin = toMinutes(jamMasuk);
    const outMin = toMinutes(jamKeluar);
    const JAM_TARGET_MASUK = 8 * 60;
    const BATAS_LEMBUR_PAGI = 7 * 60 + 30;
    const JAM_NORMAL_KELUAR = 17 * 60;
    const BATAS_LEMBUR_SORE = 17 * 60 + 30;

    let menitMasuk = 0;
    let menitKeluar = 0;
    if (inMin !== null && inMin < BATAS_LEMBUR_PAGI) {
      menitMasuk = Math.max(0, JAM_TARGET_MASUK - inMin);
    }
    if (outMin !== null && outMin > BATAS_LEMBUR_SORE) {
      menitKeluar = Math.max(0, outMin - JAM_NORMAL_KELUAR);
    }
    return { menitMasuk, menitKeluar, total: menitMasuk + menitKeluar };
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const { ok, text } = await fetchText(API_CONFIG);
      if (!ok) return;
      const cfg = await parseJSON(text);
      const src = cfg?.data && typeof cfg.data === "object" ? cfg.data : cfg;
      if (src?.start_cutoff) setCutIn(String(src.start_cutoff).slice(0, 5));
      if (src?.end_cutoff) setCutOut(String(src.end_cutoff).slice(0, 5));
      if (src?.rate_per_menit && Number(src.rate_per_menit) > 0) {
        setRatePerMenit(Number(src.rate_per_menit));
      } else if (src?.rate_per_jam && Number(src.rate_per_jam) > 0) {
        setRatePerMenit(Number(src.rate_per_jam) / 60);
      }
    } catch { }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await loadConfig();
      const candidates = [`${API_LIST}?action=list`, API_LIST];
      let dataJson: any | null = null;
      let lastErr: string | null = null;

      for (const url of candidates) {
        try {
          const { ok, text } = await fetchText(url);
          if (!ok) continue;
          dataJson = await parseJSON(text);
          break;
        } catch (e: any) { lastErr = e?.message; }
      }
      if (!dataJson) throw new Error(lastErr || "Tidak bisa memuat list lembur");

      const rowsRaw: any[] = dataJson.rows ?? dataJson.data?.rows ?? dataJson.data ?? [];

      const normalized: LemburRow[] = rowsRaw.map((r: any): LemburRow => {
        const jam_masuk = String(r.jam_masuk ?? "").slice(0, 5);
        const jam_keluar = String(r.jam_keluar ?? "").slice(0, 5);
        const jenis_lembur = String(r.jenis_lembur ?? "biasa");

        const parts = computeOvertimeParts(jam_masuk, jam_keluar);
        const totalMenit = pickServerOr(r.total_menit, parts.total);

        // 🔥 LOGIC RATE PER USER: Ambil dari field 'upah_db' (table users via JOIN di API)
        const dbRate = Number(r.rate_per_jam ?? r.upah_db ?? r.lembur ?? 0);
        const finalRatePerHour = dbRate > 0 ? dbRate : (ratePerMenit * 60);
        const finalRatePerMenit = finalRatePerHour / 60;

        let calcUpah = totalMenit * finalRatePerMenit;
        if (jenis_lembur === 'over') {
          calcUpah = calcUpah * 2;
        }

        const upah = (r.total_upah && Number(r.total_upah) > 0)
          ? Number(r.total_upah)
          : Math.ceil(calcUpah);

        return {
          id: Number(r.id),
          user_id: Number(r.user_id ?? 0),
          nama: String(r.nama ?? r.username ?? ""),
          tanggal: String(r.tanggal ?? ""),
          jam_masuk, jam_keluar,
          alasan: String(r.alasan ?? "").trim(),
          alasan_keluar: String(r.alasan_keluar ?? "").trim(),
          jenis_lembur: jenis_lembur,
          status: String(r.status ?? "approved"),
          total_menit_masuk: pickServerOr(r.total_menit_masuk, parts.menitMasuk),
          total_menit_keluar: pickServerOr(r.total_menit_keluar, parts.menitKeluar),
          total_menit: totalMenit,
          total_upah: upah,
          total_jam: typeof r.total_jam === "string" ? r.total_jam : hhmmFromMinutes(totalMenit),
          rate_per_jam: finalRatePerHour, 
        };
      });
      
      const fixRows = normalized.filter(r => r.status !== 'pending');
      setRows(fixRows);

    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal memuat data lembur");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [computeOvertimeParts, ratePerMenit, loadConfig]);

  useEffect(() => { loadData(); }, [loadData]);
  const onRefresh = () => { setRefreshing(true); loadData(); };

  function inRange(dateStr: string, s?: string, e?: string) {
    if (s && dateStr < s) return false;
    if (e && dateStr > e) return false;
    return true;
  }

  const filtered = useMemo(() => {
    const s = applied.start || undefined;
    const e = applied.end || undefined;
    const qx = applied.q.toLowerCase().trim();
    return rows.filter((r) => inRange(r.tanggal, s, e) && (qx === "" || r.nama.toLowerCase().includes(qx)));
  }, [rows, applied]);

  const weekRange = useMemo(() => getWeekRangeByOffset(weekOffset), [weekOffset]);
  const weeklyList = useMemo(() => rows.filter(r => inRange(r.tanggal, weekRange.startStr, weekRange.endStr)), [rows, weekRange]);

  const monthRange = useMemo(() => getMonthRangeByOffset(monthOffset), [monthOffset]);
  const monthlyList = useMemo(() => rows.filter(r => inRange(r.tanggal, monthRange.startStr, monthRange.endStr)), [rows, monthRange]);

  function makeSummary(list: LemburRow[]) {
    const totalMenit = list.reduce((a, b) => a + (b.total_menit ?? 0), 0);
    const totalUpah = list.reduce((a, b) => a + (b.total_upah ?? 0), 0);
    return {
      count: list.length,
      jamTotalStr: hhmmFromMinutes(totalMenit),
      upah: totalUpah,
    };
  }

  function aggregatePerUser(list: LemburRow[]): PerUser[] {
    const map = new Map<number, { nama: string; menit: number; upah: number }>();
    for (const r of list) {
      const menit = r.total_menit ?? 0;
      const upah = r.total_upah ?? 0;
      const key = (r.user_id && r.user_id > 0) ? r.user_id : -Math.abs(Date.now());
      const prev = map.get(key);
      if (prev) { prev.menit += menit; prev.upah += upah; }
      else map.set(key, { nama: r.nama || `User ${key}`, menit, upah });
    }
    const arr: PerUser[] = [];
    map.forEach((v, k) => {
      arr.push({ user_id: k, nama: v.nama, menit: v.menit, jamStr: hhmmFromMinutes(v.menit), upah: v.upah });
    });
    arr.sort((a, b) => b.upah - a.upah);
    return arr;
  }

  const [sheet, setSheet] = useState<{ visible: boolean; title: string; data: PerUser[] }>({ visible: false, title: "", data: [] });
  const [modalVisible, setModalVisible] = useState(false);
  const [editItem, setEditItem] = useState<LemburRow | null>(null);

  const [form, setForm] = useState({
    user_id: "",
    nama: "",
    tanggal: "",
    jam_masuk: "",
    jam_keluar: "",
    alasan_masuk: "",
    alasan_keluar: "",
    total_menit_masuk: "",
    total_menit_keluar: "",
    jenis_lembur: "biasa"
  });

  const [timePicker, setTimePicker] = useState<{ show: boolean; field: TimeField }>({ show: false, field: "jam_masuk" });
  function toHHMM(date: Date) { return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
  const onPickTime = (_: any, date?: Date) => {
    setTimePicker(p => ({ ...p, show: false }));
    if (!date) return;
    const hhmm = toHHMM(date);
    const next = { ...form, [timePicker.field]: hhmm } as any;
    const parts = computeOvertimeParts(next.jam_masuk || "", next.jam_keluar || "");
    next.total_menit_masuk = String(parts.menitMasuk);
    next.total_menit_keluar = String(parts.menitKeluar);
    setForm(next);
  };

  const [datePicker, setDatePicker] = useState<{ show: boolean; field: DateField | null }>({ show: false, field: null });

  const onPickDate = (_: any, date?: Date) => {
    const currentField = datePicker.field;
    setDatePicker({ show: false, field: null });

    if (!date || !currentField) return;

    const ymd = toYmd(date);

    if (currentField === 'filter_start') {
      setStart(ymd);
    } else if (currentField === 'filter_end') {
      setEnd(ymd);
    } else if (currentField === 'form_tanggal') {
      setForm(prev => ({ ...prev, tanggal: ymd }));
    }
  };

  const openModal = (item: LemburRow) => {
    setEditItem(item);
    setForm({
      user_id: String(item.user_id || ""),
      nama: item.nama,
      tanggal: item.tanggal,
      jam_masuk: item.jam_masuk,
      jam_keluar: item.jam_keluar,
      alasan_masuk: item.alasan,
      alasan_keluar: item.alasan_keluar,
      total_menit_masuk: String(item.total_menit_masuk ?? ""),
      total_menit_keluar: String(item.total_menit_keluar ?? ""),
      jenis_lembur: item.jenis_lembur || "biasa"
    });
    setModalVisible(true);
  };

  const submitForm = async () => {
    if (!editItem) return;
    try {
      const payload: any = {
        id: editItem.id,
        user_id: Number(form.user_id),
        nama: form.nama.trim(),
        tanggal: form.tanggal.trim(),
        jam_masuk: form.jam_masuk.trim(),
        jam_keluar: form.jam_keluar.trim(),
        alasan: form.alasan_masuk.trim(),
        alasan_keluar: form.alasan_keluar.trim(),
        total_menit_masuk: Number(form.total_menit_masuk || 0),
        total_menit_keluar: Number(form.total_menit_keluar || 0),
        jenis_lembur: form.jenis_lembur
      };
      const { ok, text } = await fetchText(API_LIST, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "edit", data: payload }) });
      if (!ok) throw new Error(text);
      Alert.alert("Sukses", "Data diperbarui.");
      setModalVisible(false); loadData();
    } catch (e: any) { Alert.alert("Error", e?.message); }
  };

  const handleDelete = (item: LemburRow) => {
    Alert.alert("Konfirmasi", `Yakin ingin menghapus lembur ${item.nama}?`, [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus",
        style: "destructive",
        onPress: async () => {
          try {
            const { ok } = await fetchText(API_LIST, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete", id: item.id })
            });
            if (ok) {
              Alert.alert("Sukses", "Data berhasil dihapus.");
              loadData();
            }
          } catch (e) { Alert.alert("Error", "Terjadi kesalahan koneksi."); }
        }
      }
    ]);
  };

  /** ===== Sub Components ===== */
  const TableHeader = () => (
    <View style={st.tableHeader}>
      <Text style={[st.th, { width: 180, textAlign: "left" }]}>Nama</Text>
      <Text style={[st.th, { width: 110 }]}>Tanggal</Text>
      <Text style={[st.th, { width: 90 }]}>Jam Masuk</Text>
      <Text style={[st.th, { width: 90 }]}>Jam Keluar</Text>
      <Text style={[st.th, { width: 140, textAlign: "left" }]}>Alasan Masuk</Text>
      <Text style={[st.th, { width: 140, textAlign: "left" }]}>Alasan Keluar</Text>
      <Text style={[st.th, { width: 120, textAlign: "right" }]}>Menit Masuk</Text>
      <Text style={[st.th, { width: 120, textAlign: "right" }]}>Menit Keluar</Text>
      <Text style={[st.th, { width: 90 }]}>Total Jam</Text>
      <Text style={[st.th, { width: 120, textAlign: "right" }]}>Upah/Jam</Text>
      <Text style={[st.th, { width: 150, textAlign: "right" }]}>Total Upah</Text>
      <Text style={[st.th, { width: 80 }]}>Jenis</Text>
      {tab === "data" && <Text style={[st.th, { width: 120 }]}>Aksi</Text>}
    </View>
  );

  const TableRow = React.memo(function TableRow({ item, mode }: { item: LemburRow; mode: string }) {
    return (
      <View style={st.row}>
        <Text style={[st.cell, st.left, { width: 180 }]} numberOfLines={1}>{item.nama}</Text>
        <Text style={[st.cell, st.center, { width: 110 }]}>{item.tanggal}</Text>
        <Text style={[st.cell, st.center, { width: 90 }]}>{item.jam_masuk || "-"}</Text>
        <Text style={[st.cell, st.center, { width: 90 }]}>{item.jam_keluar || "-"}</Text>
        <Text style={[st.cell, st.left, { width: 140 }]} numberOfLines={1}>{item.alasan || "-"}</Text>
        <Text style={[st.cell, st.left, { width: 140 }]} numberOfLines={1}>{item.alasan_keluar || "-"}</Text>
        <Text style={[st.cell, st.right, { width: 120 }]}>{item.total_menit_masuk}</Text>
        <Text style={[st.cell, st.right, { width: 120 }]}>{item.total_menit_keluar}</Text>
        <Text style={[st.cell, st.center, { width: 90 }]}>{item.total_jam}</Text>

        <View style={[st.cellContainer, { width: 120 }]}>
          <Text style={st.cellTextRight}>
            Rp {formatIDR(item.rate_per_jam ?? 0)}
          </Text>
          {item.jenis_lembur === 'over' && (
            <Text style={st.overText}>(x2)</Text>
          )}
        </View>

        <Text style={[st.cell, st.right, { width: 150, fontWeight: 'bold' }]}>
          Rp {formatIDR(item.total_upah ?? 0)}
        </Text>

        <Text style={[st.cell, st.center, {
          width: 80,
          fontWeight: '800',
          color: item.jenis_lembur === 'over' ? '#16a34a' : '#64748b'
        }]}>
          {item.jenis_lembur === 'over' ? "LANJUTAN" : "BIASA"}
        </Text>

        {mode === "data" && (
          <View style={{ flexDirection: 'row', justifyContent: 'center', width: 120, gap: 5 }}>
            <TouchableOpacity style={st.editBtn} onPress={() => openModal(item)}>
              <Text style={st.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.deleteBtn} onPress={() => handleDelete(item)}>
              <Text style={st.editBtnText}>Hapus</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  });

  const renderTable = (data: LemburRow[], mode: "data" | "weekly" | "monthly") => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: 1450 }}>
        <TableHeader />
        <FlatList 
          data={data} 
          keyExtractor={(item, index) => item.id > 0 ? String(item.id) : `${item.user_id}-${item.tanggal}-${index}`} 
          renderItem={({ item }) => <TableRow item={item} mode={mode} />} 
          refreshing={refreshing} 
          onRefresh={onRefresh} 
          ListEmptyComponent={<View style={st.empty}><Text style={st.emptyText}>Tidak ada data.</Text></View>} 
        />
      </View>
    </ScrollView>
  );

  if (loading) return <SafeAreaView style={st.container}><ActivityIndicator size="large" /><Text style={{ marginTop: 10 }}>Memuat data…</Text></SafeAreaView>;

  return (
    <SafeAreaView style={st.container}>
      <View style={st.headerWrap}><Text style={st.headerTitle}>Riwayat Lembur</Text></View>
      <View style={st.tabsWrap}>
        <TouchableOpacity onPress={() => setTab("data")} style={[st.tabBtn, tab === "data" && st.tabActive]}><Text style={[st.tabText, tab === "data" && st.tabTextActive]}>Data</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("weekly")} style={[st.tabBtn, tab === "weekly" && st.tabActive]}><Text style={[st.tabText, tab === "weekly" && st.tabTextActive]}>Rekap Mingguan</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("monthly")} style={[st.tabBtn, tab === "monthly" && st.tabActive]}><Text style={[st.tabText, tab === "monthly" && st.tabTextActive]}>Rekap Bulanan</Text></TouchableOpacity>
      </View>

      {tab === "data" && (
        <>
          <View style={st.card}>
            <TextInput placeholder="Cari nama karyawan" value={q} onChangeText={setQ} style={st.searchInput} />
            <View style={st.dateGrid}>
              <View style={st.dateCol}>
                <Text style={st.inputLabel}>Tanggal mulai</Text>
                <TouchableOpacity style={st.dateInputBtn} onPress={() => setDatePicker({ show: true, field: 'filter_start' })}>
                  <Text style={start ? st.dateText : st.placeholderText}>{start || "Pilih Tanggal"}</Text>
                  <Text>📅</Text>
                </TouchableOpacity>
              </View>
              <View style={st.dateCol}>
                <Text style={st.inputLabel}>Tanggal selesai</Text>
                <TouchableOpacity style={st.dateInputBtn} onPress={() => setDatePicker({ show: true, field: 'filter_end' })}>
                  <Text style={end ? st.dateText : st.placeholderText}>{end || "Pilih Tanggal"}</Text>
                  <Text>📅</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          {renderTable(filtered, "data")}
        </>
      )}

      {(tab === "weekly" || tab === "monthly") && (
        <>
          <View style={st.card}>
            <View style={st.rangeHeader}>
              <TouchableOpacity style={st.navBtn} onPress={() => tab === "weekly" ? setWeekOffset(x => x + 1) : setMonthOffset(x => x + 1)}><Text style={st.navBtnText}>‹</Text></TouchableOpacity>
              <Text style={st.rangeTitle}>{tab === "weekly" ? `${weekRange.startStr} — ${weekRange.endStr}` : monthRange.label}</Text>
              <TouchableOpacity style={st.navBtn} onPress={() => tab === "weekly" ? setWeekOffset(x => Math.max(0, x - 1)) : setMonthOffset(x => Math.max(0, x - 1))}><Text style={st.navBtnText}>›</Text></TouchableOpacity>
            </View>
          </View>
          {(() => {
            const currentList = tab === "weekly" ? weeklyList : monthlyList;
            const s = makeSummary(currentList);
            return (
              <View style={st.recapCard}>
                <Text style={st.sectionTitle}>Ringkasan {tab === "weekly" ? "Mingguan" : "Bulanan"}</Text>
                <View style={st.pillRow}>
                  <View style={st.pill}><Text style={st.pillText}>Total Lembur: {s.jamTotalStr}</Text></View>
                  <View style={st.pill}><Text style={st.pillText}>Total Biaya: Rp {formatIDR(s.upah)}</Text></View>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <TouchableOpacity style={st.printBtn} onPress={() => exportRowsToPdf(`Rekap ${tab}`, "Laporan", currentList, ratePerMenit)}><Text style={st.printBtnText}>Cetak PDF</Text></TouchableOpacity>
                  <TouchableOpacity style={[st.printBtn, { backgroundColor: "#374151" }]} onPress={() => setSheet({ visible: true, title: `Upah per User`, data: aggregatePerUser(currentList) })}><Text style={st.printBtnText}>Total per User</Text></TouchableOpacity>
                </View>
              </View>
            );
          })()}
          {renderTable(tab === "weekly" ? weeklyList : monthlyList, tab)}
        </>
      )}

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={st.modalBg}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>Edit Lembur</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={st.inputLabel}>Nama Karyawan</Text>
              <TextInput style={st.input} value={form.nama} editable={false} />
              <Text style={st.inputLabel}>Tanggal (YYYY-MM-DD)</Text>
              <TouchableOpacity style={st.dateInputBtn} onPress={() => setDatePicker({ show: true, field: 'form_tanggal' })}>
                <Text style={st.dateText}>{form.tanggal || "Pilih Tanggal"}</Text>
                <Text>📅</Text>
              </TouchableOpacity>
              <Text style={st.inputLabel}>Jam Masuk</Text>
              <TouchableOpacity style={st.input} onPress={() => setTimePicker({ show: true, field: "jam_masuk" })}>
                <Text>{form.jam_masuk}</Text>
              </TouchableOpacity>
              <Text style={st.inputLabel}>Jam Keluar</Text>
              <TouchableOpacity style={st.input} onPress={() => setTimePicker({ show: true, field: "jam_keluar" })}>
                <Text>{form.jam_keluar}</Text>
              </TouchableOpacity>
              <Text style={st.inputLabel}>Alasan Masuk</Text>
              <TextInput style={[st.input, { height: 60, textAlignVertical: 'top' }]} value={form.alasan_masuk} onChangeText={t => setForm({ ...form, alasan_masuk: t })} multiline />
              <Text style={st.inputLabel}>Alasan Keluar</Text>
              <TextInput style={[st.input, { height: 60, textAlignVertical: 'top' }]} value={form.alasan_keluar} onChangeText={t => setForm({ ...form, alasan_keluar: t })} multiline />
              <Text style={st.inputLabel}>Jenis Lembur (biasa / over)</Text>
              <TextInput style={st.input} value={form.jenis_lembur} onChangeText={t => setForm({ ...form, jenis_lembur: t })} />
            </ScrollView>
            <View style={{ flexDirection: "row", marginTop: 12 }}>
              <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#ef4444" }]} onPress={() => setModalVisible(false)}><Text style={st.modalBtnText}>Batal</Text></TouchableOpacity>
              <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#16a34a", marginLeft: 8 }]} onPress={submitForm}><Text style={st.modalBtnText}>Simpan</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={sheet.visible} transparent animationType="slide">
        <View style={st.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setSheet(s => ({ ...s, visible: false }))} />
          <View style={st.sheetPanel}>
            <View style={st.sheetHandle} /><Text style={st.sheetTitle}>{sheet.title}</Text>
            <View style={st.sheetHeaderRow}><Text style={{ flex: 2, fontWeight: 'bold' }}>Nama</Text><Text style={{ flex: 1, textAlign: 'right', fontWeight: 'bold' }}>Jam</Text><Text style={{ flex: 1, textAlign: 'right', fontWeight: 'bold' }}>Upah</Text></View>
            <ScrollView style={{ maxHeight: 360 }}>
              {sheet.data.map((u, i) => (
                <View key={i} style={st.sheetRow}><Text style={{ flex: 2 }}>{u.nama}</Text><Text style={{ flex: 1, textAlign: 'right' }}>{u.jamStr}</Text><Text style={{ flex: 1, textAlign: 'right' }}>Rp {formatIDR(u.upah)}</Text></View>
              ))}
            </ScrollView>
            <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#111827", marginTop: 10 }]} onPress={() => setSheet(s => ({ ...s, visible: false }))}><Text style={st.modalBtnText}>Tutup</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {timePicker.show && <DateTimePicker value={new Date()} mode="time" is24Hour onChange={onPickTime} />}
      {datePicker.show && <DateTimePicker value={new Date()} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={onPickDate} />}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F6F8FC", paddingHorizontal: 14, paddingTop: 8 },
  headerWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 6 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: "#1e3a8a" },
  tabsWrap: { flexDirection: "row", gap: 8, marginBottom: 8 },
  tabBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#e5e7eb" },
  tabActive: { backgroundColor: "#0b3ea4" },
  tabText: { fontWeight: "800", color: "#0f172a", fontSize: 12 },
  tabTextActive: { color: "#fff" },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: "#e5e7eb" },
  searchInput: { backgroundColor: "#f1f5f9", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { backgroundColor: "#eef4ff", borderColor: "#cfe0ff", borderWidth: 1, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999 },
  pillText: { color: "#1e40af", fontWeight: "700", fontSize: 12 },
  tableHeader: { backgroundColor: "#e8f0ff", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: "#dbe6ff" },
  th: { fontWeight: "800", color: "#1e40af", fontSize: 12, textAlign: "center" },
  row: { backgroundColor: "#fff", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 8, flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: "#eef2f7", alignItems: "center" },
  cell: { color: "#0f172a", fontSize: 12 },
  cellContainer: { justifyContent: 'center' },
  cellTextRight: { textAlign: 'right', fontSize: 12, color: '#111827' },
  overText: { fontSize: 10, fontWeight: 'bold', color: '#16a34a', textAlign: 'right' },
  left: { textAlign: "left" },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  editBtn: { backgroundColor: "#F59E0B", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, alignSelf: "center" },
  deleteBtn: { backgroundColor: "#ef4444", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, alignSelf: "center" },
  editBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  recapCard: { backgroundColor: "#fff", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginTop: 8, borderWidth: 1, borderColor: "#e5e7eb" },
  empty: { paddingVertical: 16, alignItems: "center" },
  emptyText: { color: "#64748b", fontSize: 12 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 14 },
  modalCard: { width: "95%", backgroundColor: "#fff", borderRadius: 8, padding: 12 },
  modalTitle: { fontSize: 16, fontWeight: "800", marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, backgroundColor: "#fff", fontSize: 13 },
  inputLabel: { fontSize: 12, color: "#64748b", marginBottom: 6, marginTop: 6, fontWeight: "700" },
  modalBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 8 },
  modalBtnText: { color: "#fff", fontWeight: "800" },
  rangeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { backgroundColor: "#e5e7eb", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  navBtnText: { fontWeight: "900", fontSize: 14, color: "#0f172a" },
  rangeTitle: { fontWeight: "800", color: "#0f172a" },
  printBtn: { backgroundColor: "#0b3ea4", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "#0b3ea4", alignItems: 'center' },
  printBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  dateGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dateCol: { flexGrow: 1, flexShrink: 1, flexBasis: "48%", minWidth: 160 },
  dateInputBtn: { width: "100%", backgroundColor: "#f1f5f9", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "#e5e7eb", flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dateText: { fontSize: 13, color: '#000' },
  placeholderText: { fontSize: 13, color: '#999' },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetPanel: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 14 },
  sheetHandle: { alignSelf: "center", width: 44, height: 4, borderRadius: 999, backgroundColor: "#e5e7eb", marginBottom: 8 },
  sheetTitle: { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  sheetHeaderRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  sheetRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
});