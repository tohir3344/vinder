// app/admin/IzinAdmin.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Switch,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { API_BASE } from "../../config";

const BASE = API_BASE.endsWith("/") ? API_BASE : API_BASE + "/";
const API_LIST = `${BASE}izin/izin_list.php`;
const API_SET_STATUS = `${BASE}izin/izin_set_status.php`;
const API_DELETE = `${BASE}izin/izin_delete.php`;
const API_REKAP = `${BASE}izin/izin_rekap.php`;

type IzinRow = {
  id: number;
  user_id: number;
  username?: string;
  nama?: string;
  keterangan: "IZIN" | "SAKIT";
  alasan: string;
  status: "pending" | "disetujui" | "ditolak";
  mulai: string;
  selesai: string;
  durasi_hari?: number;
  created_at?: string;
};
type ListResp = { success: boolean; data: IzinRow[]; total?: number };

type RekapUser = {
  user_id: number;
  username: string;
  total: number;
  pending: number;
  disetujui: number;
  ditolak: number;
};
type RekapMeta = {
  mode: "weekly" | "monthly";
  range: { start: string; end: string };
  year?: number;
  month?: number;
};

type RekapEntry = {
  id: number;
  user_id: number;
  username: string;
  keterangan: string;
  alasan: string;

  // Database fields
  tanggal_mulai?: string;
  tanggal_selesai?: string;

  // Fallback fields
  mulai?: string;
  start_date?: string;
  selesai?: string;
  end_date?: string;

  status: "pending" | "disetujui" | "ditolak";
  created_at: string;
};

type RekapResp = {
  success: boolean;
  meta: RekapMeta;
  by_user: RekapUser[];
  entries: RekapEntry[];
};

const LIMIT = 100;

/* ---------- utils ---------- */
function ymd(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

// Format Tanggal Indo
function formatTglIndo(isoString?: string) {
  if (!isoString || isoString === '0000-00-00') return "-";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const day = date.getDate();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}`;
}

function computeDurasi(mulai: string, selesai: string) {
  try {
    const a = new Date(mulai);
    const b = new Date(selesai);
    const diff = Math.round((+b - +a) / (24 * 3600 * 1000)) + 1;
    return diff > 0 ? diff : 1;
  } catch {
    return 1;
  }
}
function badgeColor(status: string) {
  switch (status) {
    case "pending": return "#F59E0B";
    case "disetujui": return "#22C55E";
    case "ditolak": return "#EF4444";
    default: return "#94A3B8";
  }
}
function parseDateTime(s?: string): Date | null {
  if (!s) return null;
  const t = s.replace(" ", "T");
  const d = new Date(t);
  return Number.isNaN(+d) ? null : d;
}

/* 24h window for visible list */
function isVisible24h(row: IzinRow, now = new Date()): boolean {
  const created = parseDateTime(row.created_at);
  if (created) {
    const delta = +now - +created;
    return delta >= 0 && delta <= 24 * 3600 * 1000;
  }
  const today = ymd(now);
  return row.mulai <= today && row.selesai >= today;
}

export default function IzinAdmin() {
  /* data (list 24h) */
  const [rows, setRows] = useState<IzinRow[]>([]);
  const [allRows, setAllRows] = useState<IzinRow[]>([]);

  /* UI (list) */
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* rekap modal state */
  const [recapOpen, setRecapOpen] = useState(false);
  const [recapTab, setRecapTab] = useState<"weekly" | "monthly">("weekly");
  const now = new Date();
  const [recapYear, setRecapYear] = useState<number>(now.getFullYear());
  const [recapMonth, setRecapMonth] = useState<number>(now.getMonth() + 1);
  const [recapQ, setRecapQ] = useState<string>("");
  const [recapWithEntries, setRecapWithEntries] = useState<boolean>(true);

  /* data (rekap) */
  const [recapLoading, setRecapLoading] = useState(false);
  const [rekap, setRekap] = useState<RekapResp | null>(null);
  const [recapErr, setRekapErr] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  /* guards */
  const inFlightRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const recomputeVisible = useCallback((all: IzinRow[]) => {
    const now = new Date();
    setRows(all.filter((r) => isVisible24h(r, now)));
  }, []);

  const fetchList = useCallback(async () => {
    if (inFlightRef.current) inFlightRef.current.abort();
    const ac = new AbortController();
    inFlightRef.current = ac;

    setLoading(true);
    setErrorMsg(null);

    try {
      const params = { limit: LIMIT, offset: 0 };
      const qs =
        "?" +
        Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&");

      const res = await fetch(API_LIST + qs, { signal: ac.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 160)}` : ""}`);
      }

      const raw = await res.text();
      let json: ListResp | null = null;
      try { json = JSON.parse(raw); } catch { throw new Error(`Response bukan JSON: ${raw.slice(0, 200)}`); }

      if (!json?.success || !Array.isArray(json.data)) {
        throw new Error("Payload tidak valid dari server.");
      }

      const normalized = json.data.map((r) => ({
        ...r,
        durasi_hari: r.durasi_hari ?? computeDurasi(r.mulai, r.selesai),
      }));

      if (!mountedRef.current) return;

      setAllRows(normalized);
      recomputeVisible(normalized);

      // 🔥🔥 LOGIC ALERT: CEK PENDING 🔥🔥
      const pendingCount = normalized.filter(r => r.status === 'pending').length;
      if (pendingCount > 0) {
        setTimeout(() => {
          Alert.alert(
            "Pemberitahuan",
            `Terdapat ${pendingCount} pengajuan izin baru yang perlu diproses.`,
            [{ text: "OK" }]
          );
        }, 600); // Delay dikit biar gak tabrakan sama animasi render
      }

    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setErrorMsg(String(e));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        inFlightRef.current = null;
      }
    }
  }, [recomputeVisible]);

  useEffect(() => {
    mountedRef.current = true;
    fetchList();
    return () => {
      mountedRef.current = false;
      inFlightRef.current?.abort();
    };
  }, [fetchList]);

  useEffect(() => {
    const t = setInterval(() => recomputeVisible(allRows), 60 * 1000);
    return () => clearInterval(t);
  }, [allRows, recomputeVisible]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchList();
  };

  const mutateLocal = (id: number, patch: Partial<IzinRow>) => {
    setAllRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      setRows(next.filter((r) => isVisible24h(r)));
      return next;
    });
  };

  const setStatusRow = async (row: IzinRow, next: IzinRow["status"]) => {
    const prev = row.status;
    mutateLocal(row.id, { status: next });
    try {
      const res = await fetch(API_SET_STATUS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, status: next }),
      });
      const raw = await res.text();
      const json = JSON.parse(raw);
      if (!json?.success) throw new Error(json?.message || "Gagal set status");
    } catch (e) {
      mutateLocal(row.id, { status: prev });
      setErrorMsg(String(e));
    }
  };

  const removeRow = async (row: IzinRow) => {
    const snapAll = allRows;
    const nextAll = allRows.filter((r) => r.id !== row.id);
    setAllRows(nextAll);
    recomputeVisible(nextAll);

    try {
      const res = await fetch(API_DELETE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: Number(row.id) }),
      });
      const raw = await res.text();
      const ct = res.headers.get("content-type") || "";
      let json: any = null;
      if (/application\/json/i.test(ct)) {
        try { json = JSON.parse(raw); } catch { }
      } else if (res.ok && (raw.trim() === "" || /^ok$/i.test(raw.trim()))) {
        json = { success: true };
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${raw.slice(0, 200)}`);
      if (!json || json.success !== true) {
        const msg = json?.message || raw.slice(0, 200) || "Payload bukan JSON";
        throw new Error(msg);
      }
    } catch (e: any) {
      setAllRows(snapAll);
      recomputeVisible(snapAll);
      setErrorMsg(`Gagal hapus: ${String(e)}`);
    }
  };

  const confirmDelete = (row: IzinRow) => {
    if (row.status !== "pending") {
      setErrorMsg("Hanya pengajuan berstatus 'pending' yang bisa dihapus.");
      return;
    }
    const nama = row.nama || row.username || `#${row.user_id}`;
    const msg = `Hapus pengajuan izin milik ${nama} (${row.mulai} → ${row.selesai})?\nAksi ini tidak bisa dibatalkan.`;
    import("react-native").then(({ Alert }) => {
      Alert.alert("Konfirmasi Hapus", msg, [
        { text: "Batal", style: "cancel" },
        { text: "Hapus", style: "destructive", onPress: () => removeRow(row) },
      ]);
    });
  };

  const loadRekap = useCallback(async () => {
    setRekapErr(null);
    setRekap(null);
    setRecapLoading(true);
    try {
      const url = new URL(API_REKAP);
      url.searchParams.set("mode", recapTab);
      if (recapQ.trim()) url.searchParams.set("q", recapQ.trim());
      url.searchParams.set("entries", recapWithEntries ? "1" : "0");
      if (recapTab === "monthly") {
        url.searchParams.set("year", String(recapYear));
        url.searchParams.set("month", String(recapMonth));
      }

      const res = await fetch(url.toString());
      const raw = await res.text();
      let json: RekapResp | null = null;
      try { json = JSON.parse(raw) as RekapResp; } catch {
        throw new Error(`Payload rekap bukan JSON: ${raw.slice(0, 160)}`);
      }
      if (!json?.success) throw new Error((json as any)?.message || "Gagal memuat rekap");
      setRekap(json);
    } catch (e: any) {
      setRekapErr(String(e?.message || e));
    } finally {
      setRecapLoading(false);
    }
  }, [recapTab, recapQ, recapWithEntries, recapYear, recapMonth]);

  useEffect(() => {
    if (recapOpen) loadRekap();
  }, [recapOpen, loadRekap]);

  /* ===================== GENERATE PDF ===================== */
  const generatePdf = async () => {
    if (!rekap) return;
    setPrinting(true);

    try {
      const d = new Date();
      const footerDate = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

      // 2. HTML Table Rows untuk Entries
      const entriesRows = rekap.entries.map((entry, index) => {
        const statusColor = entry.status === 'disetujui' ? 'green' : (entry.status === 'ditolak' ? 'red' : 'orange');

        const tglMulai = entry.tanggal_mulai || entry.mulai || entry.start_date || '-';
        const tglSelesai = entry.tanggal_selesai || entry.selesai || entry.end_date || '-';

        const tglDisplay = `${tglMulai}<br/>s/d<br/>${tglSelesai}`;

        return `
          <tr>
            <td style="text-align: center;">${index + 1}</td>
            <td>${entry.username}</td>
            <td>${entry.keterangan}</td>
            <td>${entry.alasan || '-'}</td>
            <td style="text-align: center;">${tglDisplay}</td>
            <td style="text-align: center;">
               <span style="color: ${statusColor}; font-weight: bold; text-transform: uppercase;">${entry.status}</span>
            </td>
          </tr>
        `;
      }).join('');

      const userRows = rekap.by_user.map((u) => `
        <tr>
          <td>${u.username}</td>
          <td style="text-align: center;">${u.total}</td>
          <td style="text-align: center;">${u.disetujui}</td>
          <td style="text-align: center;">${u.ditolak}</td>
          <td style="text-align: center;">${u.pending}</td>
        </tr>
      `).join('');

      const htmlContent = `
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
            <style>
              body { font-family: 'Helvetica', sans-serif; padding: 20px; }
              h1 { text-align: center; color: #A51C24; margin-bottom: 5px; }
              h3 { text-align: center; color: #64748B; margin-top: 0; font-weight: normal; }
              .meta { text-align: center; margin-bottom: 30px; font-size: 14px; color: #475569; }
              table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
              th, td { border: 1px solid #CBD5E1; padding: 8px; text-align: left; }
              th { background-color: #FDF2F2; color: #A51C24; font-weight: bold; text-align: center; }
              .section-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; color: #0F172A; border-bottom: 2px solid #E2E8F0; padding-bottom: 5px; margin-top: 20px; }
              .footer { text-align: right; margin-top: 40px; font-size: 10px; color: #94A3B8; }
            </style>
          </head>
          <body>
            <h1>Laporan Rekap Izin & Sakit</h1>
            <h3>PT Pordjo Steelindo Perkasa</h3>
            
            <div class="meta">
              Periode: <b>${rekap.meta.range.start}</b> s/d <b>${rekap.meta.range.end}</b><br/>
              Mode: ${rekap.meta.mode === 'monthly' ? 'Bulanan' : 'Mingguan'}
            </div>

            <div class="section-title">Ringkasan Per Karyawan</div>
            <table>
              <thead>
                <tr>
                  <th>Nama Karyawan</th>
                  <th>Total</th>
                  <th>Disetujui</th>
                  <th>Ditolak</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                ${userRows}
              </tbody>
            </table>

            ${rekapWithEntries ? `
              <div class="section-title">Rincian Pengajuan</div>
              <table>
                <thead>
                  <tr>
                    <th style="width: 30px;">No</th>
                    <th>Nama</th>
                    <th>Jenis</th>
                    <th>Alasan</th>
                    <th>Tanggal</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${entriesRows}
                </tbody>
              </table>
            ` : ''}

            <div class="footer">
              Dicetak pada: ${footerDate}
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html: htmlContent });

      if (Platform.OS === "ios") {
        await Sharing.shareAsync(uri);
      } else {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      }

    } catch (error) {
      Alert.alert("Gagal Cetak", "Terjadi kesalahan saat membuat PDF.");
      console.error(error);
    } finally {
      setPrinting(false);
    }
  };

  /* ===================== RENDER ===================== */
  const renderItem = ({ item }: { item: IzinRow }) => {
    const nama = item.nama || item.username || `#${item.user_id}`;
    const durasi = item.durasi_hari ?? computeDurasi(item.mulai, item.selesai);
    return (
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.name}>{nama}</Text>
          <View style={[s.badge, { backgroundColor: badgeColor(item.status) }]}>
            <Text style={s.badgeText}>{item.status.toUpperCase()}</Text>
          </View>
        </View>
        <Row label="Keterangan" value={item.keterangan} />
        <Row label="Alasan" value={item.alasan} />
        <Row label="Periode" value={`${item.mulai} → ${item.selesai}`} />
        <Row label="Durasi" value={`${durasi} hari`} />

        <View style={s.actionsBar}>
          <View style={s.actionsLeft}>
            <TouchableOpacity style={[s.btn, s.btnApprove]} onPress={() => setStatusRow(item, "disetujui")}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={s.btnText}>Setujui</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnReject]} onPress={() => setStatusRow(item, "ditolak")}>
              <Ionicons name="close-circle-outline" size={18} color="#fff" />
              <Text style={s.btnText}>Tolak</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, item.status === "pending" ? s.btnDelete : s.btnDisabled]}
              disabled={item.status !== "pending"}
              onPress={() => confirmDelete(item)}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={18} color="#fff" />
              <Text style={s.btnText}>Hapus</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F8FC" }}>
      {/* Top bar */}
      <View style={s.topBar}>
        <Text style={s.topTitle}>Pengajuan Izin</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={fetchList}>
            <Ionicons name="refresh-outline" size={16} color="#A51C24" />
            <Text style={s.btnGhostText}>Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setRecapOpen(true)} style={s.btnRecapTop}>
            <Ionicons name="stats-chart-outline" size={16} color="#fff" />
            <Text style={s.btnText}>Rekap</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Error banner */}
      {errorMsg && (
        <View style={s.errorBar}>
          <Text style={s.errorText} numberOfLines={2}>{errorMsg}</Text>
          <TouchableOpacity style={s.errorRetry} onPress={fetchList}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Coba lagi</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* List (≤24 jam) */}
      <FlatList
        data={rows}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20, paddingTop: 8 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListFooterComponent={
          loading ? (
            <View style={{ padding: 16, alignItems: "center" }}>
              <ActivityIndicator />
            </View>
          ) : <View style={{ height: 12 }} />
        }
        ListEmptyComponent={
          !loading && !errorMsg ? (
            <View style={{ padding: 24, alignItems: "center" }}>
              <Text style={{ color: "#94A3B8", textAlign: "center" }}>
                Belum ada pengajuan dalam 24 jam terakhir.
              </Text>
            </View>
          ) : null
        }
      />

      {/* Modal Rekap (via API) */}
      <Modal visible={recapOpen} transparent animationType="slide" onRequestClose={() => setRecapOpen(false)}>
        <View style={s.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setRecapOpen(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>Rekapan Izin</Text>
              <TouchableOpacity onPress={() => setRecapOpen(false)} style={s.closeBtn}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>Tutup</Text>
              </TouchableOpacity>
            </View>

            {/* Tab weekly / monthly */}
            <View style={s.segmentWrap}>
              {(["weekly", "monthly"] as const).map((opt) => {
                const active = recapTab === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => setRecapTab(opt)}
                    style={[s.segmentChip, active && s.segmentChipActive]}
                  >
                    <Text style={[s.segmentText, active && s.segmentTextActive]}>
                      {opt === "weekly" ? "Minggu Ini" : "Per Bulan"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Controls */}
            <View style={s.filtersRow}>
              {recapTab === "monthly" && (
                <>
                  <NumberStepper
                    label="Tahun"
                    value={recapYear}
                    onChange={(n) => setRecapYear(n)}
                    min={1970}
                    max={2100}
                  />
                  <NumberStepper
                    label="Bulan"
                    value={recapMonth}
                    onChange={(n) => setRecapMonth(Math.min(12, Math.max(1, n)))}
                    min={1}
                    max={12}
                  />
                </>
              )}
            </View>

            <View style={s.filtersRow2}>
              <View style={s.searchBox}>
                <Ionicons name="search-outline" size={16} color="#475569" />
                <TextInput
                  style={s.searchInput}
                  placeholder="Filter username…"
                  placeholderTextColor="#94A3B8"
                  value={recapQ}
                  onChangeText={setRecapQ}
                  onSubmitEditing={loadRekap}
                  returnKeyType="search"
                />
                {recapQ ? (
                  <TouchableOpacity onPress={() => { setRecapQ(""); }}>
                    <Ionicons name="close-circle" size={16} color="#334155" />
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={s.switchWrap}>
                <Text style={s.switchLabel}>Detail</Text>
                <Switch value={recapWithEntries} onValueChange={setRecapWithEntries} />
              </View>

              <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={loadRekap}>
                <Ionicons name="refresh-outline" size={16} color="#A51C24" />
              </TouchableOpacity>
            </View>

            {/* Result */}
            {recapLoading ? (
              <View style={{ paddingVertical: 24, alignItems: "center" }}>
                <ActivityIndicator />
                <Text style={{ color: "#475569", marginTop: 8 }}>Menghitung rekap…</Text>
              </View>
            ) : recapErr ? (
              <View style={s.errorBar}>
                <Text style={s.errorText} numberOfLines={2}>{recapErr}</Text>
                <TouchableOpacity style={s.errorRetry} onPress={loadRekap}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Coba lagi</Text>
                </TouchableOpacity>
              </View>
            ) : rekap ? (
              <ScrollView
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
              >
                {/* Periode */}
                <View style={s.periodBar}>
                  <Ionicons name="calendar-outline" size={16} color="#A51C24" />
                  <Text style={s.periodText}>
                    Periode <Text style={{ fontWeight: "800" }}>{rekap.meta.range.start}</Text>
                    {"  "}s/d{"  "}
                    <Text style={{ fontWeight: "800" }}>{rekap.meta.range.end}</Text>
                  </Text>
                </View>

                {/* TOMBOL CETAK PDF */}
                <TouchableOpacity
                  style={[s.btnPdf, printing && { opacity: 0.7 }]}
                  onPress={generatePdf}
                  disabled={printing}
                >
                  {printing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="print-outline" size={20} color="#fff" />}
                  <Text style={s.btnPdfText}>{printing ? "Menyiapkan PDF..." : "Cetak Laporan PDF"}</Text>
                </TouchableOpacity>

                {/* Stat Summary */}
                <View style={s.statGrid}>
                  <StatCard title="Total User" value={rekap.by_user.length} bg="#FDF2F2" bd="#FCA5A5" />
                  <StatCard
                    title="Total Pengajuan"
                    value={rekap.by_user.reduce((a, b) => a + b.total, 0)}
                    bg="#FDF2F2"
                    bd="#FECACA"
                  />
                </View>

                {/* Legend */}
                <View style={s.legendRow}>
                  <LegendPill label="Total" tint="#A51C24" />
                  <LegendPill label="Pending" tint="#f59e0b" />
                  <LegendPill label="Disetujui" tint="#22c55e" />
                  <LegendPill label="Ditolak" tint="#ef4444" />
                </View>

                {/* By User */}
                <View style={s.block}>
                  <Text style={s.blockTitle}>Per User</Text>
                  {rekap.by_user.length === 0 ? (
                    <Text style={{ color: "#64748b" }}>—</Text>
                  ) : (
                    <FlatList
                      data={rekap.by_user}
                      keyExtractor={(it) => String(it.user_id)}
                      renderItem={({ item }) => (
                        <View style={s.userRow}>
                          <Text style={s.userName}>{item.username}</Text>
                          <View style={s.userPills}>
                            <CountPill color="#A51C24" label="Total" value={item.total} />
                            <CountPill color="#f59e0b" label="Pending" value={item.pending} />
                            <CountPill color="#22c55e" label="Disetujui" value={item.disetujui} />
                            <CountPill color="#ef4444" label="Ditolak" value={item.ditolak} />
                          </View>
                        </View>
                      )}
                      scrollEnabled={false}
                      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                    />
                  )}
                </View>

                {/* Entries (optional) */}
                {recapWithEntries && (
                  <View style={s.block}>
                    <Text style={s.blockTitle}>Entries</Text>
                    {rekap.entries.length === 0 ? (
                      <Text style={{ color: "#64748b" }}>—</Text>
                    ) : (
                      <FlatList
                        data={rekap.entries}
                        keyExtractor={(it) => String(it.id)}
                        renderItem={({ item }) => {
                          const dur = computeDurasi(item.mulai || item.tanggal_mulai || '', item.selesai || item.tanggal_selesai || '');
                          return (
                            <View style={s.entryCard}>
                              <View style={s.entryHeaderRow}>
                                <Text style={s.entryHead}>{item.username}</Text>
                                <View style={[s.badge, { backgroundColor: badgeColor(item.status) }]}>
                                  <Text style={s.badgeText}>{item.status.toUpperCase()}</Text>
                                </View>
                              </View>

                              <View style={s.entryLine}>
                                <Ionicons name="document-text-outline" size={14} color="#334155" />
                                <Text style={s.entryTextStrong}>{item.keterangan}</Text>
                              </View>

                              <View style={s.entryLine}>
                                <Ionicons name="calendar-outline" size={14} color="#334155" />
                                <Text style={s.entryText}>
                                  Mulai: <Text style={s.entryTextStrong}>{item.mulai || item.tanggal_mulai || '-'}</Text>
                                  {"  "}Selesai: <Text style={s.entryTextStrong}>{item.selesai || item.tanggal_selesai || '-'}</Text>
                                  {"  "}Durasi: <Text style={s.entryTextStrong}>{dur} hari</Text>
                                </Text>
                              </View>

                              <View style={s.entryLine}>
                                <Ionicons name="time-outline" size={14} color="#334155" />
                                <Text style={s.entryMuted}>Dibuat: {item.created_at}</Text>
                              </View>

                              {item.alasan?.trim() ? (
                                <View style={s.entryLine}>
                                  <Ionicons name="chatbubble-ellipses-outline" size={14} color="#334155" />
                                  <Text style={s.entryMuted} numberOfLines={3}>{item.alasan}</Text>
                                </View>
                              ) : null}
                            </View>
                          );
                        }}
                        scrollEnabled={false}
                        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                      />
                    )}
                  </View>
                )}
              </ScrollView>
            ) : (
              <Text style={{ color: "#64748b" }}>Tidak ada data untuk dihitung.</Text>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* tiny row */
function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{String(value ?? "-")}</Text>
    </View>
  );
}

/* small helper components */
function NumberStepper({
  label, value, onChange, min, max,
}: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <View style={s.stepper}>
      <Text style={s.stepperLabel}>{label}</Text>
      <View style={s.stepperCtrls}>
        <TouchableOpacity
          style={[s.stepperBtn, { opacity: min !== undefined && value <= min ? 0.5 : 1 }]}
          disabled={min !== undefined && value <= min}
          onPress={() => onChange(value - 1)}
        >
          <Ionicons name="remove-outline" size={16} color="#A51C24" />
        </TouchableOpacity>
        <Text style={s.stepperValue}>{value}</Text>
        <TouchableOpacity
          style={[s.stepperBtn, { opacity: max !== undefined && value >= max ? 0.5 : 1 }]}
          disabled={max !== undefined && value >= max}
          onPress={() => onChange(value + 1)}
        >
          <Ionicons name="add-outline" size={16} color="#A51C24" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StatCard({ title, value, bg, bd }: { title: string; value: number; bg: string; bd: string }) {
  return (
    <View style={[s.statCard, { backgroundColor: bg, borderColor: bd }]}>
      <Text style={s.statTitle}>{title}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

function LegendPill({ label, tint }: { label: string; tint: string }) {
  return (
    <View style={[s.legendPill, { backgroundColor: `${tint}22`, borderColor: `${tint}55` }]}>
      <View style={[s.dot, { backgroundColor: tint }]} />
      <Text style={[s.legendText, { color: "#0f172a" }]}>{label}</Text>
    </View>
  );
}

function CountPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[s.countPill, { borderColor: `${color}66`, backgroundColor: `${color}14` }]}>
      <Text style={[s.countPillText, { color: "#0f172a" }]}>
        {label}: <Text style={{ fontWeight: "900" }}>{value}</Text>
      </Text>
    </View>
  );
}

/* styles */
const s = StyleSheet.create({
  /* top bar */
  topBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topTitle: { flex: 1, color: "#A51C24", fontSize: 20, fontWeight: "900" },
  btnRecapTop: {
    backgroundColor: "#A51C24",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    shadowColor: "#A51C24",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  btnGhost: {
    backgroundColor: "#E5E7EB",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  btnGhostText: { color: "#A51C24", fontWeight: "800" },

  /* error */
  errorBar: {
    backgroundColor: "#FEE2E2",
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 10,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: { flex: 1, color: "#7F1D1D", fontWeight: "600" },
  errorRetry: {
    backgroundColor: "#DC2626",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },

  /* list rows */
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  name: { fontSize: 16, fontWeight: "800", color: "#0F172A", flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },

  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  infoLabel: { color: "#64748B", fontSize: 12, fontWeight: "700" },
  infoValue: { color: "#0F172A", fontSize: 14, fontWeight: "700" },

  /* actions bar */
  actionsBar: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  actionsLeft: { flexDirection: "row", gap: 8, flexShrink: 1 },
  btn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  btnApprove: { backgroundColor: "#16A34A" },
  btnReject: { backgroundColor: "#EF4444" },
  btnDelete: { backgroundColor: "#475569" },
  btnDisabled: { backgroundColor: "#CBD5E1" },
  btnText: { color: "#fff", fontWeight: "800", letterSpacing: 0.2 },

  /* modal / sheet */
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "78%",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#E2E8F0",
    marginBottom: 8,
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sheetTitle: { fontSize: 16, fontWeight: "900", color: "#A51C24" },
  closeBtn: { backgroundColor: "#EF4444", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },

  segmentWrap: { flexDirection: "row", gap: 8, marginBottom: 4 },
  segmentChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#E2E8F0",
  },
  segmentChipActive: { backgroundColor: "#A51C24" },
  segmentText: { color: "#0F172A", fontWeight: "800", fontSize: 12 },
  segmentTextActive: { color: "#fff" },

  filtersRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  filtersRow2: { flexDirection: "row", gap: 10, alignItems: "center" },

  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchInput: { flex: 1, color: "#0F172A" },
  switchWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchLabel: { color: "#0F172A", fontWeight: "700" },

  statGrid: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12 },
  statTitle: { color: "#475569", fontSize: 12, marginBottom: 6, fontWeight: "800" },
  statValue: { color: "#A51C24", fontSize: 18, fontWeight: "900" },

  legendRow: { flexDirection: "row", gap: 8, alignItems: "center" },

  block: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, padding: 10 },
  blockTitle: { color: "#0F172A", fontWeight: "900", marginBottom: 6 },

  userRow: { gap: 6 },
  userName: { color: "#0F172A", fontWeight: "900", fontSize: 14 },
  userPills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },

  legendPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },

  legendText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  dot: { width: 8, height: 8, borderRadius: 999 },

  countPill: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  countPillText: { fontSize: 12, fontWeight: "700" },

  entryCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
  },
  entryHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  entryHead: { color: "#0F172A", fontWeight: "900" },
  entryLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  entryText: { color: "#0F172A" },
  entryTextStrong: { color: "#0F172A", fontWeight: "900" },
  entryMuted: { color: "#64748B" },

  /* Stepper (month/year) */
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  stepperLabel: {
    color: "#0F172A",
    fontWeight: "800",
    marginRight: 8,
    fontSize: 12,
  },
  stepperCtrls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepperBtn: {
    backgroundColor: "#E5E7EB",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    minWidth: 36,
    textAlign: "center",
    fontWeight: "900",
    color: "#0F172A",
  },

  periodBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  periodText: { color: "#A51C24" },

  /* Tombol PDF Baru */
  btnPdf: {
    backgroundColor: "#BE185D", // Pink/Maroon
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 10,
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
    shadowColor: "#BE185D",
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  btnPdfText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  }
});