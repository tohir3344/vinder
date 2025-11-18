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
} from "react-native";
import type { ListRenderItem } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker"; // expo install @react-native-community/datetimepicker
import * as Print from "expo-print";       // expo install expo-print
import * as Sharing from "expo-sharing";   // expo install expo-sharing
import { API_BASE as RAW_API_BASE } from "../../config";

/* ====== API base: sterilkan trailing slash ====== */
const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";

/** ===== Types ===== */
type LemburRow = {
  id: number;
  user_id: number;
  nama: string;
  tanggal: string;            // YYYY-MM-DD
  jam_masuk: string;          // "HH:mm[:ss]"
  jam_keluar: string;
  alasan: string;             // gabungan (masuk / keluar)
  total_menit?: number;
  total_menit_masuk?: number | null;
  total_menit_keluar?: number | null;
  total_jam?: string;         // "H:MM"
  total_upah?: number | null; // rupiah
};

type UserLite = { id: number; username: string; nama: string };

/** ===== Endpoint ===== */
const API_LIST   = `${API_BASE}lembur/lembur_list.php`;
const API_CONFIG = `${API_BASE}lembur/lembur_list.php?action=config`;
const API_USERS  = `${API_BASE}auth/get_all_users_detail.php`; // {success:true,data:[{id,username,nama_lengkap}]}

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

/** ===== Helper tanggal (Mingguan/Bulanan) ===== */
const pad2 = (x: number) => String(x).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Monday-based week (Senin–Minggu)
function getMonday(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0=Senin, ... 6=Minggu
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function getWeekRangeByOffset(offset: number) {
  // offset=0 => minggu ini; offset=1 => minggu lalu; dst
  const today = new Date();
  const thisMon = getMonday(today);
  const start = addDays(thisMon, -7 * offset);
  const end = addDays(start, 6);
  return { start, end, startStr: toYmd(start), endStr: toYmd(end) };
}

const monthNamesId = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
function getMonthRangeByOffset(offset: number) {
  // offset=0 => bulan ini; 1 => bulan lalu; dst
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const base = new Date(y, m - offset, 1);
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  start.setHours(0,0,0,0); end.setHours(23,59,59,999);
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
      const totalJam =
        r.total_jam ??
        (typeof r.total_menit === "number"
          ? `${Math.floor(r.total_menit / 60)} jam ${r.total_menit % 60} mnt`
          : "-");
      const alasan = r.alasan ?? "";
      return `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="c">${esc(r.tanggal ?? "")}</td>
        <td>${esc(nama)}</td>
        <td class="c">${fmtTime(r.jam_masuk)}</td>
        <td class="c">${fmtTime(r.jam_keluar)}</td>
        <td class="c">${esc(totalJam)}</td>
        <td>${esc(alasan)}</td>
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
  body { font-family: Arial, Helvetica, sans-serif; color:#111; }
  .wrap { padding: 18px 22px; }
  .header { text-align:center; margin-bottom:14px; }
  .header .title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  .header .company { font-size: 14px; font-weight: 600; margin-top: 2px; }
  .header .meta { font-size: 11px; color:#444; margin-top: 4px; }
  table { width:100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 6px 8px; font-size: 12px; }
  th { background:#f2f2f2; font-weight:700; }
  td.c, th.c { text-align:center; }
  .note { margin-top: 14px; font-size: 11px; }
  .note .n-title { font-weight:700; margin-bottom:4px; }
  .sign { margin-top: 38px; display:flex; justify-content:flex-end; }
  .sign .box { width: 220px; text-align:center; font-size: 12px; }
  .sign .line { margin-top: 60px; border-top:1px solid #000; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="title">SURAT PERINTAH LEMBUR</div>
      <div class="company">${esc(company)}</div>
      ${rangeLabel ? `<div class="meta">${esc(rangeLabel)}</div>` : ``}
    </div>

    <table>
      <thead>
        <tr>
          <th class="c" style="width:34px;">No</th>
          <th class="c" style="width:90px;">Tanggal</th>
          <th>Nama Karyawan</th>
          <th class="c" style="width:90px;">Mulai Lembur</th>
          <th class="c" style="width:90px;">Akhir Lembur</th>
          <th class="c" style="width:90px;">Total Lembur</th>
          <th style="width:240px;">Keterangan</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows || `<tr><td class="c" colspan="7">Tidak ada data</td></tr>`}
      </tbody>
    </table>

    <div class="note">
      <div class="n-title">NOTE :</div>
      <div>1. ISI BERDASARKAN TANGGAL</div>
      <div>2. WAJIB DIISI MINIMAL SEHARI SETELAH LEMBUR</div>
    </div>

    <div class="sign">
      <div class="box">
        <div>PARAF ATASAN</div>
        <div class="line">&nbsp;</div>
      </div>
    </div>
  </div>
</body>
</html>`;
};

async function exportRowsToPdf(title: string, rangeLabel: string, list: LemburRow[], ratePerMenit: number) {
  if (!list.length) { Alert.alert("PDF", "Tidak ada data untuk dicetak."); return; }
  const html = buildPdfHtml(title, rangeLabel, list, ratePerMenit);
  const file = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { dialogTitle: title });
  } else {
    Alert.alert("PDF Tersimpan", file.uri);
  }
}

/** ===== Screen ===== */
export default function LemburAdmin() {
  const [rows, setRows] = useState<LemburRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Cutoff & rate dari server (SSoT)
  const [cutIn, setCutIn] = useState("08:00");
  const [cutOut, setCutOut] = useState("17:00");
  const [ratePerMenit, setRatePerMenit] = useState<number>(10000 / 60);

  // ====== TAB MODE ======
  const [tab, setTab] = useState<"data" | "weekly" | "monthly">("data");

  // Weekly recap: default minggu lalu
  const [weekOffset, setWeekOffset] = useState<number>(1);

  // Monthly recap: default bulan ini
  const [monthOffset, setMonthOffset] = useState<number>(0);

  // Filter (tab Data)
  const todayStr = useMemo(() => {
    const d = new Date(); const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }, []);
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

  /** ===== Hitung lembur (ikut cutoff server) ===== */
  const computeOvertimeParts = useCallback((jamMasuk: string, jamKeluar: string) => {
    const inMin  = toMinutes(jamMasuk)  ?? Number.POSITIVE_INFINITY;
    const outMin = toMinutes(jamKeluar) ?? Number.NEGATIVE_INFINITY;
    const cIn    = toMinutes(cutIn)  ?? 8 * 60;
    const cOut   = toMinutes(cutOut) ?? 17 * 60;
    const menitMasuk  = Math.max(0, cIn  - inMin);
    const menitKeluar = Math.max(0, outMin - cOut);
    return { menitMasuk, menitKeluar, total: menitMasuk + menitKeluar };
  }, [cutIn, cutOut]);

  /** ===== Load Config (cutoff & rate) ===== */
  const loadConfig = useCallback(async () => {
    try {
      const { ok, text } = await fetchText(API_CONFIG);
      if (!ok) return;
      const cfg = await parseJSON(text);

      // dukung format: {start_cutoff, end_cutoff, rate_per_menit|rate_per_jam} atau {data:{...}}
      const src = cfg?.data && typeof cfg.data === "object" ? cfg.data : cfg;

      if (src?.start_cutoff) setCutIn(String(src.start_cutoff).slice(0, 5));
      if (src?.end_cutoff)   setCutOut(String(src.end_cutoff).slice(0, 5));

      if (src?.rate_per_menit && Number(src.rate_per_menit) > 0) {
        setRatePerMenit(Number(src.rate_per_menit));
      } else if (src?.rate_per_jam && Number(src.rate_per_jam) > 0) {
        setRatePerMenit(Number(src.rate_per_jam) / 60);
      }
    } catch {}
  }, []);

  /** ===== Load Data ===== */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await loadConfig();

      const candidates = [
        `${API_LIST}?action=list`,
        `${API_LIST}?action=summary`,
        API_LIST,
      ];

      let dataJson: any | null = null;
      let lastErr: string | null = null;

      for (const url of candidates) {
        try {
          const { ok, status, statusText, text } = await fetchText(url);
          if (!ok) { lastErr = `HTTP ${status} ${statusText}`; continue; }
          const j = await parseJSON(text);
          dataJson = j;
          break;
        } catch (e: any) {
          lastErr = e?.message ?? String(e);
        }
      }
      if (!dataJson) throw new Error(lastErr || "Tidak bisa memuat list lembur");

      const rowsRaw: any[] =
        dataJson.rows ??
        dataJson.data?.rows ??
        dataJson.data ??
        dataJson.list ??
        [];

      const normalized: LemburRow[] = rowsRaw.map((r: any): LemburRow => {
        const jam_masuk  = String(r.jam_masuk ?? "").slice(0, 5);
        const jam_keluar = String(r.jam_keluar ?? "").slice(0, 5);

        const alasanMasuk  = (r.alasan ?? "").toString().trim();
        const alasanKeluar = (r.alasan_keluar ?? "").toString().trim();
        const alasan =
          alasanMasuk && alasanKeluar
            ? `Masuk: ${alasanMasuk} | Keluar: ${alasanKeluar}`
            : alasanMasuk || alasanKeluar || "";

        const parts = computeOvertimeParts(jam_masuk, jam_keluar);
        const menitMasuk  = pickServerOr(r.total_menit_masuk, parts.menitMasuk);
        const menitKeluar = pickServerOr(r.total_menit_keluar, parts.menitKeluar);
        const totalMenit  = pickServerOr(r.total_menit, menitMasuk + menitKeluar);

        const rowRatePerMenit = Number(r.rate_per_menit ?? NaN);
        const rpm = Number.isFinite(rowRatePerMenit) && rowRatePerMenit > 0 ? rowRatePerMenit : ratePerMenit;

        const upah = pickServerOr(r.total_upah, totalMenit * rpm);
        const jamStr =
          typeof r.total_jam === "string" && r.total_jam.trim() !== ""
            ? r.total_jam
            : hhmmFromMinutes(totalMenit);

        return {
          id: Number(r.id),
          user_id: Number(r.user_id ?? 0),
          nama: String(r.nama ?? r.name ?? r.username ?? ""),
          tanggal: String(r.tanggal ?? r.date ?? ""),
          jam_masuk,
          jam_keluar,
          alasan,
          total_menit_masuk: menitMasuk,
          total_menit_keluar: menitKeluar,
          total_menit: totalMenit,
          total_upah: upah,
          total_jam: jamStr,
        };
      });

      setRows(normalized);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal memuat data lembur");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [computeOvertimeParts, ratePerMenit, loadConfig]);

  useEffect(() => { loadData(); }, [loadData]);
  const onRefresh = () => { setRefreshing(true); loadData(); };

  /** ===== Helpers ===== */
  function inRange(dateStr: string, s?: string, e?: string) {
    if (s && dateStr < s) return false;
    if (e && dateStr > e) return false;
    return true;
  }

  /** ===== Filtering (Tab: Data) ===== */
  const filtered = useMemo(() => {
    const s = applied.start || undefined;
    const e = applied.end || undefined;
    const qx = applied.q.toLowerCase().trim();
    return rows.filter(
      (r) => inRange(r.tanggal, s, e) && (qx === "" || r.nama.toLowerCase().includes(qx))
    );
  }, [rows, applied]);

  /** ======== Rekap Mingguan (tab weekly) ======== */
  const weekRange = useMemo(() => getWeekRangeByOffset(weekOffset), [weekOffset]);
  const weeklyList = useMemo(
    () => rows.filter(r => inRange(r.tanggal, weekRange.startStr, weekRange.endStr)),
    [rows, weekRange]
  );

  /** ======== Rekap Bulanan (tab monthly) ======== */
  const monthRange = useMemo(() => getMonthRangeByOffset(monthOffset), [monthOffset]);
  const monthlyList = useMemo(
    () => rows.filter(r => inRange(r.tanggal, monthRange.startStr, monthRange.endStr)),
    [rows, monthRange]
  );

  /** ===== Ringkasan util ===== */
  function makeSummary(list: LemburRow[]) {
    const menitMasuk = list.reduce((a, b) => a + (b.total_menit_masuk || 0), 0);
    const menitKeluar = list.reduce((a, b) => a + (b.total_menit_keluar || 0), 0);
    const totalMenit = list.reduce((a, b) => a + (b.total_menit ?? ((b.total_menit_masuk || 0) + (b.total_menit_keluar || 0))), 0);
    return {
      count: list.length,
      menitMasuk,
      menitKeluar,
      totalMenit,
      jamMasukStr: hhmmFromMinutes(menitMasuk),
      jamKeluarStr: hhmmFromMinutes(menitKeluar),
      jamTotalStr: hhmmFromMinutes(totalMenit),
      upah: totalMenit * ratePerMenit,
    };
  }

  /** ===== Aggregate per user (untuk modal) ===== */
 /** ===== Aggregate per user (untuk modal) ===== */
type PerUser = { user_id: number; nama: string; menit: number; jamStr: string; upah: number };

/** Hash string simpel (32-bit) tanpa extend prototype */
function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // keep 32-bit
  }
  return h;
}

function aggregatePerUser(list: LemburRow[]): PerUser[] {
  const map = new Map<number, { nama: string; menit: number }>();

  for (const r of list) {
    const menit = r.total_menit ?? ((r.total_menit_masuk || 0) + (r.total_menit_keluar || 0));

    // kunci stabil: pakai user_id kalau ada, kalau nggak ada pakai hash dari nama (dibuat negatif biar beda range)
    const key = (r.user_id && r.user_id > 0) ? r.user_id : -Math.abs(stringHash(r.nama || "") || 0);

    const prev = map.get(key);
    if (prev) prev.menit += menit;
    else map.set(key, { nama: r.nama || `User ${key}`, menit });
  }

  const arr: PerUser[] = [];
  map.forEach((v, k) => {
    arr.push({
      user_id: k,
      nama: v.nama,
      menit: v.menit,
      jamStr: hhmmFromMinutes(v.menit),
      upah: v.menit * ratePerMenit,
    });
  });

  arr.sort((a, b) => b.upah - a.upah);
  return arr;
}


  /** ===== Bottom Sheet state ===== */
  const [sheet, setSheet] = useState<{ visible: boolean; title: string; data: PerUser[] }>({
    visible: false, title: "", data: [],
  });

  /** ===== Form (Tambah/Edit) ===== */
  const [modalVisible, setModalVisible] = useState(false);
  const [editItem, setEditItem] = useState<LemburRow | null>(null);
  const [form, setForm] = useState({
    user_id: "",
    nama: "",
    tanggal: "",
    jam_masuk: "",
    jam_keluar: "",
    alasan: "",
    total_menit_masuk: "",
    total_menit_keluar: "",
  });

  // User picker
  const [users, setUsers] = useState<UserLite[]>([]);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const loadUsers = useCallback(async () => {
    try {
      const { ok, text } = await fetchText(API_USERS);
      if (!ok) return;
      const j = await parseJSON(text);
      const arr = (j?.data ?? j ?? []).map((u: any): UserLite => ({
        id: Number(u.id),
        username: String(u.username ?? ""),
        nama: String(u.nama_lengkap ?? u.name ?? u.username ?? ""),
      }));
      setUsers(arr);
    } catch {}
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const k = userSearch.trim().toLowerCase();
    if (!k) return users.slice(0, 50);
    return users
      .filter(u => u.nama.toLowerCase().includes(k) || u.username.toLowerCase().includes(k))
      .slice(0, 50);
  }, [userSearch, users]);

  // Time picker & auto-hitung menit
  const [timePicker, setTimePicker] = useState<{ show: boolean; field: TimeField }>({ show: false, field: "jam_masuk" });
  function toHHMM(date: Date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
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
  useEffect(() => {
    const parts = computeOvertimeParts(form.jam_masuk || "", form.jam_keluar || "");
    setForm(f => ({
      ...f,
      total_menit_masuk: String(parts.menitMasuk),
      total_menit_keluar: String(parts.menitKeluar),
    }));
  }, [form.jam_masuk, form.jam_keluar, cutIn, cutOut]);

  const openModal = (item?: LemburRow) => {
    if (item) {
      setEditItem(item);
      setForm({
        user_id: String(item.user_id || ""),
        nama: item.nama,
        tanggal: item.tanggal,
        jam_masuk: item.jam_masuk,
        jam_keluar: item.jam_keluar,
        alasan: item.alasan,
        total_menit_masuk: String(item.total_menit_masuk ?? ""),
        total_menit_keluar: String(item.total_menit_keluar ?? ""),
      });
    } else {
      setEditItem(null);
      setForm({
        user_id: "",
        nama: "",
        tanggal: todayStr,
        jam_masuk: "",
        jam_keluar: "",
        alasan: "",
        total_menit_masuk: "",
        total_menit_keluar: "",
      });
    }
    setUserSearch("");
    setModalVisible(true);
  };

  const submitForm = async () => {
    const userIdNum = Number(form.user_id);
    const useUserId = Number.isInteger(userIdNum) && userIdNum > 0;
    const nameTrim = (form.nama || "").trim();

    if (!useUserId) return Alert.alert("Error", "Nama harus dipilih dari daftar users.");
    if (!form.tanggal) return Alert.alert("Error", "Tanggal wajib diisi");
    if (!form.jam_masuk || !form.jam_keluar) return Alert.alert("Error", "Jam Masuk & Jam Keluar wajib diisi");

    try {
      const payload: any = {
        tanggal: form.tanggal.trim(),
        jam_masuk: form.jam_masuk.trim(),
        jam_keluar: form.jam_keluar.trim(),
        alasan: form.alasan.trim(),
        total_menit_masuk: Number(form.total_menit_masuk || 0),
        total_menit_keluar: Number(form.total_menit_keluar || 0),
      };
      if (useUserId) payload.user_id = userIdNum; else payload.nama = nameTrim;
      if (editItem) payload.id = editItem.id;

      const body = JSON.stringify({ action: editItem ? "edit" : "create", data: payload });

      const { ok, status, statusText, text } = await fetchText(API_LIST, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body,
      });
      if (!ok) throw new Error(`HTTP ${status} ${statusText}\n${text}`);
      const j = await parseJSON(text);
      if (j.error) throw new Error(j.error);

      Alert.alert("Sukses", editItem ? "Data lembur diperbarui." : `Data lembur dibuat (id=${j.id ?? "?"}).`);
      setModalVisible(false);
      loadData();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal menyimpan data lembur");
    }
  };

  /** ===== Row renderer (mode-aware) ===== */
  const makeRenderItem = (
    mode: "data" | "weekly" | "monthly"
  ): ListRenderItem<LemburRow> => {
    const RowItem: ListRenderItem<LemburRow> = ({ item }) => {
      const parts = computeOvertimeParts(item.jam_masuk, item.jam_keluar);
      const menitMasuk  = pickServerOr(item.total_menit_masuk, parts.menitMasuk);
      const menitKeluar = pickServerOr(item.total_menit_keluar, parts.menitKeluar);
      const totalMenit  = pickServerOr(item.total_menit, menitMasuk + menitKeluar);
      const jamStr      = item.total_jam ?? hhmmFromMinutes(totalMenit);
      const upah        = pickServerOr(item.total_upah, totalMenit * ratePerMenit);

      return (
        <View style={st.row}>
          <Text style={[st.cell, st.left,   { width: 180 }]} numberOfLines={1}>{item.nama}</Text>
          <Text style={[st.cell, st.center, { width: 110 }]}>{item.tanggal}</Text>
          <Text style={[st.cell, st.center, { width:  90 }]}>{item.jam_masuk || "-"}</Text>
          <Text style={[st.cell, st.center, { width:  90 }]}>{item.jam_keluar || "-"}</Text>
          <Text style={[st.cell, st.left,   { width: 220 }]} numberOfLines={1}>{item.alasan || "-"}</Text>
          <Text style={[st.cell, st.right,  { width: 120 }]}>{menitMasuk}</Text>
          <Text style={[st.cell, st.right,  { width: 120 }]}>{menitKeluar}</Text>
          <Text style={[st.cell, st.center, { width:  90 }]}>{jamStr}</Text>
          <Text style={[st.cell, st.right,  { width: 150 }]}>Rp {formatIDR(upah)}</Text>

          {mode === "data" && (
            <TouchableOpacity style={st.editBtn} onPress={() => openModal(item)}>
              <Text style={st.editBtnText}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    };

    (RowItem as any).displayName = `RowItem_${mode}`;
    return RowItem;
  };

  /** ===== Reusable table renderer (mode-aware) ===== */
  const renderTable = (data: LemburRow[], mode: "data" | "weekly" | "monthly") => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: 1160 }}>
        <View style={st.tableHeader}>
          <Text style={[st.th, { width: 180, textAlign: "left" }]}>Nama</Text>
          <Text style={[st.th, { width: 110 }]}>Tanggal</Text>
          <Text style={[st.th, { width:  90 }]}>Jam Masuk</Text>
          <Text style={[st.th, { width:  90 }]}>Jam Keluar</Text>
          <Text style={[st.th, { width: 220, textAlign: "left" }]}>Keterangan</Text>
          <Text style={[st.th, { width: 120, textAlign: "right" }]}>Menit Masuk</Text>
          <Text style={[st.th, { width: 120, textAlign: "right" }]}>Menit Keluar</Text>
          <Text style={[st.th, { width:  90 }]}>Total Jam</Text>
          <Text style={[st.th, { width: 150, textAlign: "right" }]}>Total Upah</Text>
          {mode === "data" && <Text style={[st.th, { width: 80 }]}>Aksi</Text>}
        </View>

        <FlatList
          data={data}
          keyExtractor={(i) => String(i.id)}
          renderItem={makeRenderItem(mode)}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={
            <View style={st.empty}>
              <Text style={st.emptyText}>Tidak ada data pada rentang ini.</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 10 }}
        />
      </View>
    </ScrollView>
  );

  /** ===== Loading ===== */
  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>Memuat data…</Text>
      </SafeAreaView>
    );
  }

  /** ===== UI ===== */
  return (
    <SafeAreaView style={st.container}>
      {/* Header */}
      <View style={st.headerWrap}>
        <Text style={st.headerTitle}>Riwayat Lembur (Admin)</Text>
        <TouchableOpacity style={st.addBtn} onPress={() => openModal()}>
          <Text style={st.addBtnText}>+ Tambah Data</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs: Data | Rekap Mingguan | Rekap Bulanan */}
      <View style={st.tabsWrap}>
        <TouchableOpacity onPress={() => setTab("data")} style={[st.tabBtn, tab==="data" && st.tabActive]}><Text style={[st.tabText, tab==="data" && st.tabTextActive]}>Data</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("weekly")} style={[st.tabBtn, tab==="weekly" && st.tabActive]}><Text style={[st.tabText, tab==="weekly" && st.tabTextActive]}>Rekap Mingguan</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("monthly")} style={[st.tabBtn, tab==="monthly" && st.tabActive]}><Text style={[st.tabText, tab==="monthly" && st.tabTextActive]}>Rekap Bulanan</Text></TouchableOpacity>
      </View>

      {/* === TAB: DATA === */}
      {tab === "data" && (
        <>
          {/* Filter */}
          <View style={st.card}>
            <TextInput
              placeholder="Cari berdasarkan nama"
              value={q}
              onChangeText={setQ}
              style={st.searchInput}
            />

            {/* Grid tanggal 2 kolom yang responsif */}
            <View style={st.dateGrid}>
              <View style={st.dateCol}>
                <Text style={st.inputLabel}>Tanggal mulai</Text>
                <TextInput
                  placeholder="YYYY-MM-DD"
                  value={start}
                  onChangeText={(t)=>{ setStart(t); }}
                  autoCapitalize="none"
                  style={st.dateInput}
                />
              </View>

              <View style={st.dateCol}>
                <Text style={st.inputLabel}>Tanggal selesai</Text>
                <TextInput
                  placeholder="YYYY-MM-DD"
                  value={end}
                  onChangeText={(t)=>{ setEnd(t); }}
                  autoCapitalize="none"
                  style={st.dateInput}
                />
              </View>
            </View>

            <Text style={st.hint}>Filter diterapkan otomatis saat Anda mengetik.</Text>
          </View>

          {/* Tabel */}
          {renderTable(filtered, "data")}

          {/* ⛔️ Ringkasan bawah DIHAPUS sesuai permintaan */}
        </>
      )}

      {/* === TAB: REKAP MINGGUAN === */}
      {tab === "weekly" && (
        <>
          <View style={st.card}>
            <View style={st.rangeHeader}>
              <TouchableOpacity
                style={st.navBtn}
                onPress={() => setWeekOffset((x) => x + 1)}
              >
                <Text style={st.navBtnText}>‹</Text>
              </TouchableOpacity>

              <Text style={st.rangeTitle}>
                {toYmd(weekRange.start)} — {toYmd(weekRange.end)}
                {weekOffset === 0 ? " (Minggu ini)" : (weekOffset === 1 ? " (Minggu lalu)" : ` (-${weekOffset} minggu)`)}
              </Text>

              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TouchableOpacity
                  style={[st.navBtn, weekOffset === 0 && { opacity: 0.4 }]}
                  disabled={weekOffset === 0}
                  onPress={() => setWeekOffset((x) => Math.max(0, x - 1))}
                >
                  <Text style={st.navBtnText}>›</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Ringkasan minggu aktif (tanpa pill Total Upah) */}
          {(() => {
            const s = makeSummary(weeklyList);
            const label = `Minggu ${weekRange.startStr} — ${weekRange.endStr}`;
            return (
              <View style={st.recapCard}>
                <Text style={st.sectionTitle}>Ringkasan Mingguan</Text>
                <View style={st.pillRow}>
                  <View style={st.pill}><Text style={st.pillText}>Kegiatan: {s.count}</Text></View>
                  <View style={st.pill}><Text style={st.pillText}>Menit Masuk: {s.menitMasuk} ({s.jamMasukStr})</Text></View>
                  <View style={st.pill}><Text style={st.pillText}>Menit Keluar: {s.menitKeluar} ({s.jamKeluarStr})</Text></View>
                  <View style={st.pill}><Text style={st.pillText}>Total Lembur: {s.totalMenit} ({s.jamTotalStr})</Text></View>
                  {/* ⛔️ Pill Total Upah dihapus */}
                </View>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    style={st.printBtn}
                    onPress={() => exportRowsToPdf("Rekap Lembur Mingguan", label, weeklyList, ratePerMenit)}
                  >
                    <Text style={st.printBtnText}>Cetak PDF</Text>
                  </TouchableOpacity>

                  {/* Tombol modal total per user (tetap) */}
                  <TouchableOpacity
                    style={[st.printBtn, { backgroundColor: "#374151", borderColor: "#374151" }]}
                    onPress={() => {
                      setSheet({ visible: true, title: `Total Upah per User — ${label}`, data: aggregatePerUser(weeklyList) });
                    }}
                  >
                    <Text style={st.printBtnText}>Total per User</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

          {/* Tabel mingguan */}
          {renderTable(weeklyList, "weekly")}
        </>
      )}

      {/* === TAB: REKAP BULANAN === */}
      {tab === "monthly" && (
        <>
          <View style={st.card}>
            <View style={st.rangeHeader}>
              <TouchableOpacity
                style={st.navBtn}
                onPress={() => setMonthOffset((x) => x + 1)}
              >
                <Text style={st.navBtnText}>‹</Text>
              </TouchableOpacity>

              <Text style={st.rangeTitle}>
                {monthRange.label} ({monthRange.startStr} — {monthRange.endStr})
                {monthOffset === 0 ? " (Bulan ini)" : ` (-${monthOffset} bln)`}
              </Text>

              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TouchableOpacity
                  style={[st.navBtn, monthOffset === 0 && { opacity: 0.4 }]}
                  disabled={monthOffset === 0}
                  onPress={() => setMonthOffset((x) => Math.max(0, x - 1))}
                >
                  <Text style={st.navBtnText}>›</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Ringkasan bulanan (tanpa pill Total Upah) */}
          {(() => {
            const s = makeSummary(monthlyList);
            const label = `${monthRange.label} (${monthRange.startStr} — ${monthRange.endStr})`;
            return (
              <View style={st.recapCard}>
                <Text style={st.sectionTitle}>Ringkasan Bulanan</Text>
                <View style={st.pillRow}>
                  <View style={st.pill}><Text style={st.pillText}>Kegiatan: {s.count}</Text></View>
                  <View style={st.pill}><Text style={st.pillText}>Menit Masuk: {s.menitMasuk} ({s.jamMasukStr})</Text></View>
                  <View style={st.pill}><Text style={st.pillText}>Menit Keluar: {s.menitKeluar} ({s.jamKeluarStr})</Text></View>
                  <View style={st.pill}><Text style={st.pillText}>Total Lembur: {s.totalMenit} ({s.jamTotalStr})</Text></View>
                  {/* ⛔️ Pill Total Upah dihapus */}
                </View>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    style={st.printBtn}
                    onPress={() => exportRowsToPdf("Rekap Lembur Bulanan", label, monthlyList, ratePerMenit)}
                  >
                    <Text style={st.printBtnText}>Cetak PDF</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.printBtn, { backgroundColor: "#374151", borderColor: "#374151" }]}
                    onPress={() => {
                      setSheet({ visible: true, title: `Total Upah per User — ${label}`, data: aggregatePerUser(monthlyList) });
                    }}
                  >
                    <Text style={st.printBtnText}>Total per User</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

          {/* Tabel bulanan */}
          {renderTable(monthlyList, "monthly")}
        </>
      )}

      {/* Modal Tambah/Edit */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={st.modalBg}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>{editItem ? "Edit Lembur" : "Tambah Lembur"}</Text>

            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {/* NAMA (dropdown dari tabel users) */}
              <Text style={st.inputLabel}>Nama (ambil dari Users)</Text>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setUserPickerOpen(true)}
                style={[st.input, { justifyContent: "center" }]}
              >
                <Text style={{ color: form.nama ? "#0f172a" : "#9ca3af" }}>
                  {form.nama || "Pilih nama…"}
                </Text>
              </TouchableOpacity>

              {/* TANGGAL */}
              <TextInput
                placeholder="Tanggal (YYYY-MM-DD)"
                style={st.input}
                value={form.tanggal}
                onChangeText={(t) => setForm({ ...form, tanggal: t })}
                autoCapitalize="none"
              />

              {/* JAM MASUK */}
              <Text style={st.inputLabel}>Jam Masuk</Text>
              <TouchableOpacity
                style={[st.input, { justifyContent: "center" }]}
                onPress={() => setTimePicker({ show: true, field: "jam_masuk" })}
              >
                <Text style={{ color: form.jam_masuk ? "#0f172a" : "#9ca3af" }}>
                  {form.jam_masuk || "Pilih jam…"}
                </Text>
              </TouchableOpacity>

              {/* JAM KELUAR */}
              <Text style={st.inputLabel}>Jam Keluar</Text>
              <TouchableOpacity
                style={[st.input, { justifyContent: "center" }]}
                onPress={() => setTimePicker({ show: true, field: "jam_keluar" })}
              >
                <Text style={{ color: form.jam_keluar ? "#0f172a" : "#9ca3af" }}>
                  {form.jam_keluar || "Pilih jam…"}
                </Text>
              </TouchableOpacity>

              {/* ALASAN */}
              <TextInput
                placeholder="Alasan (Masuk/Keluar)"
                style={st.input}
                value={form.alasan}
                onChangeText={(t) => setForm({ ...form, alasan: t })}
              />

              {/* MENIT (auto & read-only) */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={st.inputLabel}>Menit Lembur Masuk</Text>
                  <View style={[st.input, { backgroundColor: "#f3f4f6" }]}>
                    <Text>{String(form.total_menit_masuk || 0)}</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.inputLabel}>Menit Lembur Keluar</Text>
                  <View style={[st.input, { backgroundColor: "#f3f4f6" }]}>
                    <Text>{String(form.total_menit_keluar || 0)}</Text>
                  </View>
                </View>
              </View>

              <View style={{ marginTop: 6 }}>
                <Text style={st.previewText}>
                  Pra-Tinjau: Masuk {form.total_menit_masuk || 0} mnt ({hhmmFromMinutes(Number(form.total_menit_masuk || 0))})
                  • Keluar {form.total_menit_keluar || 0} mnt ({hhmmFromMinutes(Number(form.total_menit_keluar || 0))})
                  • Total {Number(form.total_menit_masuk || 0) + Number(form.total_menit_keluar || 0)} mnt
                </Text>
              </View>
            </ScrollView>

            <View style={{ flexDirection: "row", marginTop: 12 }}>
              <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#ef4444" }]} onPress={() => setModalVisible(false)}>
                <Text style={st.modalBtnText}>Batal</Text>
              </TouchableOpacity> 
              <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#16a34a", marginLeft: 8 }]} onPress={submitForm}>
                <Text style={st.modalBtnText}>Simpan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* TimePicker */}
      {timePicker.show && (
        <DateTimePicker
          value={new Date()}
          mode="time"
          is24Hour
          onChange={onPickTime}
        />
      )}

      {/* Modal User Picker */}
      <Modal visible={userPickerOpen} transparent animationType="slide" onRequestClose={() => setUserPickerOpen(false)}>
        <View style={st.modalBg}>
          <View style={[st.modalCard, { maxHeight: 520 }]}>
            <Text style={st.modalTitle}>Pilih Nama</Text>
            <TextInput
              placeholder="Cari nama/username…"
              style={st.input}
              value={userSearch}
              onChangeText={setUserSearch}
            />
            <FlatList
              data={filteredUsers}
              keyExtractor={(u) => String(u.id)}
              style={{ maxHeight: 400 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={st.userItem}
                  onPress={() => {
                    setForm(f => ({ ...f, user_id: String(item.id), nama: item.nama }));
                    setUserPickerOpen(false);
                  }}
                >
                  <Text style={st.userName}>{item.nama}</Text>
                  <Text style={st.userSub}>@{item.username} · ID {item.id}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={{ color: "#9ca3af", padding: 8 }}>Tidak ada hasil.</Text>}
            />
            <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#6b7280", marginTop: 10 }]} onPress={() => setUserPickerOpen(false)}>
              <Text style={st.modalBtnText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ===== Bottom Sheet: Total per User ===== */}
      <Modal
        visible={sheet.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(s => ({ ...s, visible: false }))}
      >
        <View style={st.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setSheet(s => ({ ...s, visible: false }))} />
          <View style={st.sheetPanel}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>{sheet.title}</Text>

            <View style={st.sheetHeaderRow}>
              <Text style={[st.sheetHead, { flex: 2 }]}>Nama</Text>
              <Text style={[st.sheetHead, { flex: 1, textAlign: "right" }]}>Total Lembur</Text>
              <Text style={[st.sheetHead, { flex: 1, textAlign: "right" }]}>Total Upah</Text>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {sheet.data.length === 0 ? (
                <Text style={{ color: "#6b7280", paddingVertical: 12 }}>Tidak ada data</Text>
              ) : (
                sheet.data.map((u) => (
                  <View key={String(u.user_id) + u.nama} style={st.sheetRow}>
                    <Text style={[st.sheetCell, { flex: 2 }]} numberOfLines={1}>{u.nama}</Text>
                    <Text style={[st.sheetCell, { flex: 1, textAlign: "right" }]}>{u.jamStr}</Text>
                    <Text style={[st.sheetCell, { flex: 1, textAlign: "right" }]}>Rp {formatIDR(u.upah)}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={[st.modalBtn, { backgroundColor: "#111827", marginTop: 10 }]}
              onPress={() => setSheet(s => ({ ...s, visible: false }))}
            >
              <Text style={st.modalBtnText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** ===== Styles ===== */
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F6F8FC", paddingHorizontal: 14, paddingTop: 8 },

  headerWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 6 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: "#1e3a8a" },
  addBtn: { backgroundColor: "#0b3ea4", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  tabsWrap: { flexDirection: "row", gap: 8, marginBottom: 8 },
  tabBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#e5e7eb" },
  tabActive: { backgroundColor: "#0b3ea4" },
  tabText: { fontWeight: "800", color: "#0f172a", fontSize: 12 },
  tabTextActive: { color: "#fff" },

  card: { backgroundColor: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: "#e5e7eb", overflow: "hidden" },
  searchInput: { backgroundColor: "#f1f5f9", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, marginBottom: 8 },

  hint: { marginTop: 6, color: "#64748b", fontSize: 11 },

  sectionTitle: { fontSize: 13, fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { backgroundColor: "#eef4ff", borderColor: "#cfe0ff", borderWidth: 1, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999 },
  pillText: { color: "#1e40af", fontWeight: "700", fontSize: 12 },

  tableHeader: { backgroundColor: "#e8f0ff", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: "#dbe6ff" },
  th: { fontWeight: "800", color: "#1e40af", fontSize: 12, textAlign: "center" },

  row: { backgroundColor: "#fff", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 8, flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: "#eef2f7" },
  cell: { color: "#0f172a", fontSize: 12 },
  left: { textAlign: "left" },
  right: { textAlign: "right" },
  center: { textAlign: "center" },

  editBtn: { backgroundColor: "#F59E0B", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, alignSelf: "center", marginLeft: 8 },
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
  previewText: { color: "#0f172a", fontWeight: "700", fontSize: 12 },

  userItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eef2f7" },
  userName: { fontWeight: "800", color: "#0f172a" },
  userSub: { color: "#64748b", fontSize: 12 },

  rangeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { backgroundColor: "#e5e7eb", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  navBtnText: { fontWeight: "900", fontSize: 14, color: "#0f172a" },
  rangeTitle: { fontWeight: "800", color: "#0f172a" },

  printBtn: {
    backgroundColor: "#0b3ea4",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#0b3ea4",
  },
  printBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  dateGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dateCol: { flexGrow: 1, flexShrink: 1, flexBasis: "48%", minWidth: 160 },
  dateInput: {
    width: "100%",
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  // Bottom sheet
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetPanel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 14,
  },
  sheetHandle: { alignSelf: "center", width: 44, height: 4, borderRadius: 999, backgroundColor: "#e5e7eb", marginBottom: 8 },
  sheetTitle: { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  sheetHeaderRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  sheetHead: { fontSize: 12, fontWeight: "800", color: "#1e40af" },
  sheetRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  sheetCell: { fontSize: 12, color: "#0f172a" },
});
