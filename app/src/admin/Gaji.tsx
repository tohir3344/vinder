// app/admin/GajiAdmin.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE as RAW_API_BASE } from "../../config";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { Ionicons } from "@expo/vector-icons";

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";

// ===== Endpoints =====
const API_USERS = `${API_BASE}gaji/gaji_users.php`;
const API_PREVIEW = `${API_BASE}gaji/gaji_preview.php`;
const API_SAVE = `${API_BASE}gaji/gaji_save.php`;
const API_SLIP = `${API_BASE}gaji/gaji_slip.php`;
const API_ARCH = `${API_BASE}gaji/gaji_archive.php`;
const API_SLIP_STATUS = `${API_BASE}gaji/gaji_status.php`;

// ===== Types =====
type UserOpt = { id: number; nama: string; gaji?: number };

type PreviewResp = {
  user_id: number;
  nama: string;
  periode_start: string;
  periode_end: string;
  hadir_minggu: number;
  lembur_menit: number;
  lembur_rp: number;
  angsuran_rp: number;
  gaji_pokok_rp?: number;
};

type ArchiveRow = {
  id: number;
  user_id: number;
  nama: string;
  periode_start: string;
  periode_end: string;
  hadir_minggu: number;
  lembur_menit: number;
  lembur_rp: number;
  gaji_pokok_rp: number;
  angsuran_rp: number;
  thr_rp?: number | null;
  bonus_akhir_tahun_rp?: number | null;
  others_total_rp?: number | null;
  total_gaji_rp: number;
  created_at?: string;
  others_json?: any;
  status_bayar?: string | null;
  paid_at?: string | null;
};

type OtherItem = { label: string; amount: number };

function parseOthers(row: any): OtherItem[] {
  if (!row || !row.others_json) return [];
  let raw = row.others_json as any;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const out: OtherItem[] = [];
  for (const o of raw) {
    if (!o) continue;
    const label = String(o.label ?? "Lainnya");
    const amt = parseInt(String(o.amount ?? 0), 10);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    out.push({ label, amount: amt });
  }
  return out;
}

// ===== Helpers =====
const fmtIDR = (n: number) => (n ?? 0).toLocaleString("id-ID");
const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfWeek = (d: Date) => {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = dt.getDay();
  const diffToMonday = (dow + 6) % 7;
  dt.setDate(dt.getDate() - diffToMonday);
  return dt;
};
const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

const monthLabelID = (d: Date) =>
  d.toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

// ====== FILE EXPORT HELPERS ======
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_");

export async function htmlToPdfAndShare(basename: string, html: string) {
  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (Platform.OS === "ios") {
        await Sharing.shareAsync(uri);
    } else {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
    }
  } catch (e: any) {
    Alert.alert("Gagal", e?.message || String(e));
  }
}

const tableStyle = `
  <style>
    *{font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial;}
    h1,h2,h3{margin:0 0 8px 0;}
    .meta{color:#666;margin-bottom:10px;}
    table{width:100%;border-collapse:collapse;}
    th,td{border:1px solid #e5e7eb;padding:8px;font-size:12px;text-align:left;}
    th{background:#f3f4f6}
    tfoot td{font-weight:bold}
  </style>
`;

const C = {
  primary: "#2196F3",
  primaryDark: "#0066CC",
  primarySoft: "#E8F1FF",
  text: "#0B1A33",
  muted: "#6B7A90",
  border: "#E3ECFF",
  bg: "#F6F9FF",
  card: "#FFFFFF",
};

// ======= Small UI helpers =======
function Row({ label, value, isDeduction }: { label: string; value: string, isDeduction?: boolean }) {
  return (
    <View style={st.row}>
      <Text style={st.rowLabel}>{label}</Text>
      <Text style={[st.rowVal, isDeduction && { color: '#D32F2F' }]}>{value}</Text>
    </View>
  );
}
function RowStrong({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.row}>
      <Text style={[st.rowLabel, { fontWeight: "700", color: C.text }]}>
        {label}
      </Text>
      <Text style={[st.rowVal, { fontWeight: "800", color: C.primaryDark }]}>
        {value}
      </Text>
    </View>
  );
}
function Sep() {
  return <View style={{ height: 1, backgroundColor: C.border, marginVertical: 10 }} />;
}
function StatusPill({ status }: { status?: string | null }) {
  let label = "Belum dibayar";
  let bg = "#fee2e2";
  let color = "#b91c1c";

  if (status === "paid") {
    label = "Sudah dibayar";
    bg = "#dcfce7";
    color = "#166534";
  }

  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

// ===== Helper Komponen Detail Gaji (Biar Rapi & Reusable) =====
const GajiDetailCard = ({ item }: { item: ArchiveRow }) => {
    const others = parseOthers(item);
    const hasOthers = others.length > 0;
    const hasTHR = (item.thr_rp || 0) > 0;
    const hasBonus = (item.bonus_akhir_tahun_rp || 0) > 0;
    const angsuran = item.angsuran_rp || 0;

    return (
        <View style={st.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                    <Text style={st.h3}>{item.nama}</Text>
                    <Text style={{ color: C.muted, fontSize: 12 }}>
                        {item.periode_start} s/d {item.periode_end}
                    </Text>
                </View>
                <StatusPill status={item.status_bayar} />
            </View>

            <View style={st.sep} />

            <Row label="Gaji Pokok" value={`Rp ${fmtIDR(item.gaji_pokok_rp)}`} />
            <Row label="Lembur" value={`Rp ${fmtIDR(item.lembur_rp)} (${item.lembur_menit} mnt)`} />
            
            {/* Detail Tambahan */}
            {hasTHR && <Row label="THR" value={`Rp ${fmtIDR(item.thr_rp || 0)}`} />}
            {hasBonus && <Row label="Bonus Akhir Tahun" value={`Rp ${fmtIDR(item.bonus_akhir_tahun_rp || 0)}`} />}
            
            {/* Rincian Lainnya (Looping) */}
            {hasOthers && others.map((o, idx) => (
                 <Row key={idx} label={o.label} value={`Rp ${fmtIDR(o.amount)}`} />
            ))}
            {/* Fallback kalau others ada totalnya tapi gak ada rincian JSON (misal data lama) */}
            {!hasOthers && (item.others_total_rp || 0) > 0 && (
                <Row label="Lainnya (Total)" value={`Rp ${fmtIDR(item.others_total_rp || 0)}`} />
            )}

            {/* Potongan */}
            <Row label="Potongan Angsuran" value={`- Rp ${fmtIDR(angsuran)}`} isDeduction />

            <View style={st.sep} />
            <RowStrong label="Total Diterima" value={`Rp ${fmtIDR(item.total_gaji_rp)}`} />
        </View>
    );
};

// ===== Komponen Utama =====
export default function GajiAdmin() {
  const [tab, setTab] = useState<"hitung" | "slip" | "arsip">("hitung");
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [userModal, setUserModal] = useState<{ visible: boolean; target: "hitung" | "slip" | "arsip" }>({ visible: false, target: "hitung" });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(API_USERS);
        const json = await res.json();
        if (json.success) setUsers(json.data || []);
      } catch (e) { console.log("err users", e); }
    })();
  }, []);

  // ====== Tab Hitung Gaji ======
  const [hitUser, setHitUser] = useState<UserOpt | null>(null);
  const [hitStart, setHitStart] = useState<Date>(startOfWeek(new Date()));
  const [hitEnd, setHitEnd] = useState<Date>(endOfWeek(new Date()));

  const [hitShowStart, setHitShowStart] = useState(false);
  const [hitShowEnd, setHitShowEnd] = useState(false);

  const [hitLoading, setHitLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);

  const [gajiPokok, setGajiPokok] = useState<string>("");
  const [thr, setThr] = useState<string>("");
  const [bonusAkhirTahun, setBonusAkhirTahun] = useState<string>("");
  const [others, setOthers] = useState<{ id: string; label: string; amount: string }[]>([]);

  useEffect(() => {
    if (!hitUser) {
      setGajiPokok(""); setThr(""); setBonusAkhirTahun(""); setOthers([]);
      return;
    }
    setGajiPokok(""); setThr(""); setBonusAkhirTahun(""); setOthers([]);
  }, [hitUser?.id]);

  const addOther = () => setOthers(p => [...p, { id: String(Date.now()), label: "", amount: "" }]);
  const updOther = (id: string, field: "label" | "amount", v: string) => {
    setOthers(p => p.map(o => o.id === id ? { ...o, [field]: v } : o));
  };
  const delOther = (id: string) => setOthers(p => p.filter(o => o.id !== id));

  useEffect(() => {
    const load = async () => {
      if (!hitUser) return;
      setHitLoading(true);
      try {
        const url = `${API_PREVIEW}?user_id=${hitUser.id}&start=${iso(hitStart)}&end=${iso(hitEnd)}`;
        const res = await fetch(url);
        const json = await res.json();
        
        if (json.success && json.data) {
            const d = json.data;
            setPreview({
                user_id: Number(d.user_id),
                nama: String(d.nama),
                periode_start: String(d.periode_start),
                periode_end: String(d.periode_end),
                hadir_minggu: Number(d.hadir_minggu ?? 0),
                lembur_menit: Number(d.lembur_menit ?? 0),
                lembur_rp: Number(d.lembur_rp ?? 0),
                angsuran_rp: Number(d.angsuran_rp ?? 0),
                gaji_pokok_rp: Number(d.gaji_pokok_rp ?? hitUser.gaji ?? 0),
            });
            setGajiPokok(prev => prev === "" ? String(d.gaji_pokok_rp || 0) : prev);
        } else {
            setPreview(null);
        }
      } catch (e: any) {
        setPreview(null);
        Alert.alert("Error", e.message || String(e));
      } finally {
        setHitLoading(false);
      }
    };
    load();
  }, [hitUser, hitStart, hitEnd]);

  const othersTotal = useMemo(() => others.reduce((a, o) => a + (parseInt(o.amount || "0") || 0), 0), [others]);

  const totalHitung = useMemo(() => {
    if (!preview) return 0;
    const gp = parseInt(gajiPokok || "0", 10);
    const t = parseInt(thr || "0", 10);
    const b = parseInt(bonusAkhirTahun || "0", 10);
    return gp + (preview.lembur_rp || 0) - (preview.angsuran_rp || 0) + t + b + othersTotal;
  }, [preview, gajiPokok, thr, bonusAkhirTahun, othersTotal]);

  const saveHitung = async () => {
    if (!hitUser || !preview) return;
    const gp = parseInt(gajiPokok || "0", 10);
    if (!gp || gp <= 0) return Alert.alert("Validasi", "Gaji wajib diisi.");

    try {
      setHitLoading(true);
      const body = {
        user_id: hitUser.id,
        start: preview.periode_start,
        end: preview.periode_end,
        gaji_pokok_rp: gp,
        thr_rp: thr ? parseInt(thr) : null,
        bonus_akhir_tahun_rp: bonusAkhirTahun ? parseInt(bonusAkhirTahun) : null,
        others: others.filter(o => o.amount && parseInt(o.amount) > 0),
      };

      const res = await fetch(API_SAVE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!json.success) throw new Error(json.message);
      
      Alert.alert("Berhasil", "Slip gaji tersimpan.", [
          { text: "OK", onPress: () => setTab("slip") }
      ]);
      
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setHitLoading(false);
    }
  };

  // ====== Tab Slip Gaji ======
  const [slipUser, setSlipUser] = useState<UserOpt | null>(null);
  const [slipMode, setSlipMode] = useState<"single" | "all">("single");
  const [slipPeriodMode, setSlipPeriodMode] = useState<"week" | "month">("week");
  
  const [slipStart, setSlipStart] = useState<Date>(startOfWeek(new Date()));
  const [slipEnd, setSlipEnd] = useState<Date>(endOfWeek(new Date()));
  const [slipMonthAnchor, setSlipMonthAnchor] = useState<Date>(new Date());
  
  const [slipShowStart, setSlipShowStart] = useState(false);
  const [slipShowEnd, setSlipShowEnd] = useState(false);
  const [slipShowMonthPicker, setSlipShowMonthPicker] = useState(false);
  
  const [slipLoading, setSlipLoading] = useState(false);
  const [slip, setSlip] = useState<ArchiveRow | null>(null); // Typenya ArchiveRow biar konsisten
  const [slipList, setSlipList] = useState<ArchiveRow[]>([]);
  const [slipStatusLoading, setSlipStatusLoading] = useState(false);

  useEffect(() => {
    if (slipPeriodMode === "week") {
      const now = new Date();
      setSlipStart(startOfWeek(now));
      setSlipEnd(endOfWeek(now));
    } else {
      const now = new Date();
      setSlipMonthAnchor(now);
      setSlipStart(startOfMonth(now));
      setSlipEnd(endOfMonth(now));
    }
  }, [slipPeriodMode]);

  const loadSlip = async () => {
    setSlipLoading(true);
    try {
        if (slipMode === "single") {
            if (!slipUser) throw new Error("Pilih karyawan dulu");
            const url = `${API_ARCH}?user_id=${slipUser.id}&start=${iso(slipStart)}&end=${iso(slipEnd)}&limit=1&mode=${slipPeriodMode}`;
            const res = await fetch(url);
            const json = await res.json();
            
            if (!json.success || !json.data || json.data.length === 0) {
                throw new Error("Data tidak ditemukan");
            }
            setSlip(json.data[0]);
            setSlipList([]);
        } else {
            const url = `${API_ARCH}?start=${iso(slipStart)}&end=${iso(slipEnd)}&limit=1000&mode=${slipPeriodMode}`; 
            const res = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.message || "Data kosong");
            
            setSlipList(json.data || []);
            setSlip(null);
        }
    } catch (e: any) {
        setSlip(null);
        setSlipList([]);
        Alert.alert("Info", e.message);
    } finally {
        setSlipLoading(false);
    }
  };

  const updateSlipStatus = async (newStatus: "paid" | "unpaid") => {
    if (!slip) return;
    try {
      setSlipStatusLoading(true);
      const res = await fetch(API_SLIP_STATUS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: slip.id, status_bayar: newStatus }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      await loadSlip();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSlipStatusLoading(false);
    }
  };

  // ====== Tab Arsip ======
  const [arsipUser, setArsipUser] = useState<UserOpt | null>(null);
  const [arsip, setArsip] = useState<ArchiveRow[]>([]);
  const [arsipLoading, setArsipLoading] = useState(false);

  const [arsipStart, setArsipStart] = useState<Date>(startOfWeek(new Date()));
  const [arsipEnd, setArsipEnd] = useState<Date>(endOfWeek(new Date()));
  const [arsipShowStart, setArsipShowStart] = useState(false);
  const [arsipShowEnd, setArsipShowEnd] = useState(false);

  const loadArsip = async () => {
    setArsipLoading(true);
    try {
        let url = `${API_ARCH}?start=${iso(arsipStart)}&end=${iso(arsipEnd)}&limit=500&mode=week`; 
        if (arsipUser) url += `&user_id=${arsipUser.id}`;
        const res = await fetch(url);
        const json = await res.json();
        setArsip(Array.isArray(json.data) ? json.data : json.data?.rows ?? []);
    } catch (e) { setArsip([]); } 
    finally { setArsipLoading(false); }
  }

  const exportSlipListPDF = async () => {
    if (!slipList?.length) return Alert.alert("Info", "Tidak ada data.");
    const head = `
      ${tableStyle}
      <h2>Slip Gaji - ${slipPeriodMode === 'month' ? 'Bulanan' : 'Mingguan'}</h2>
      <div class="meta">Periode ${iso(slipStart)} s/d ${iso(slipEnd)}</div>
      <table>
        <thead>
          <tr>
            <th>Nama</th><th>Gaji Pokok</th><th>Lembur</th><th>Angsuran</th><th>THR</th><th>Bonus</th><th>Lainnya</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
    `;
    const rows = slipList.map((r) => `
      <tr>
        <td>${r.nama}</td>
        <td>Rp ${fmtIDR(r.gaji_pokok_rp)}</td>
        <td>Rp ${fmtIDR(r.lembur_rp)}</td>
        <td>Rp ${fmtIDR(r.angsuran_rp)}</td>
        <td>Rp ${fmtIDR(r.thr_rp || 0)}</td>
        <td>Rp ${fmtIDR(r.bonus_akhir_tahun_rp || 0)}</td>
        <td>Rp ${fmtIDR(r.others_total_rp || 0)}</td>
        <td>Rp ${fmtIDR(r.total_gaji_rp)}</td>
      </tr>
    `).join("");
    const html = `${head}${rows}</tbody></table>`;
    const name = `slip_laporan_${iso(slipStart)}.pdf`;
    await htmlToPdfAndShare(name, html);
  };

  const exportArsipPDF = async () => {
    if (!arsip?.length) return Alert.alert("Info", "Tidak ada data.");
    const head = `
      ${tableStyle}
      <h2>Laporan Arsip Gaji</h2>
      <div class="meta">Periode ${iso(arsipStart)} s/d ${iso(arsipEnd)}</div>
      <table>
        <thead>
          <tr>
            <th>Nama</th><th>Gaji Pokok</th><th>Lembur</th><th>Angsuran</th><th>THR</th><th>Bonus</th><th>Lainnya</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
    `;
    const rows = arsip.map((r) => `
      <tr>
        <td>${r.nama}</td>
        <td>Rp ${fmtIDR(r.gaji_pokok_rp)}</td>
        <td>Rp ${fmtIDR(r.lembur_rp)}</td>
        <td>Rp ${fmtIDR(r.angsuran_rp)}</td>
        <td>Rp ${fmtIDR(r.thr_rp || 0)}</td>
        <td>Rp ${fmtIDR(r.bonus_akhir_tahun_rp || 0)}</td>
        <td>Rp ${fmtIDR(r.others_total_rp || 0)}</td>
        <td>Rp ${fmtIDR(r.total_gaji_rp)}</td>
      </tr>
    `).join("");
    const html = `${head}${rows}</tbody></table>`;
    const name = `arsip_${iso(arsipStart)}.pdf`;
    await htmlToPdfAndShare(name, html);
  }

  // ====== UI ======
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={st.headerWrap}>
        <Text style={st.title}>Gaji Admin</Text>
        <View style={st.tabs}>
          {["hitung", "slip", "arsip"].map((t) => (
            <TouchableOpacity
              key={t}
              style={[st.tabBtn, tab === t && st.tabActive]}
              onPress={() => setTab(t as any)}
            >
              <Text style={[st.tabTx, tab === t && st.tabTxActive]}>
                {t === "hitung" ? "Hitung" : t === "slip" ? "Slip Gaji" : "Arsip"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={st.body}>
        {/* === TAB 1: HITUNG GAJI === */}
        {tab === "hitung" && (
          <View>
            <Text style={st.label}>Karyawan</Text>
            <TouchableOpacity style={st.select} onPress={() => setUserModal({ visible: true, target: "hitung" })}>
              <Text style={st.selectTx}>{hitUser ? hitUser.nama : "Pilih Karyawan"}</Text>
              <Ionicons name="chevron-down" size={20} color={C.muted} />
            </TouchableOpacity>

            <Text style={st.label}>Periode Hitung (Mingguan)</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity style={st.inputBtn} onPress={() => setHitShowStart(true)}>
                    <Text>{iso(hitStart)}</Text>
                </TouchableOpacity>
                <Text style={{ alignSelf: 'center' }}>s/d</Text>
                <TouchableOpacity style={st.inputBtn} onPress={() => setHitShowEnd(true)}>
                    <Text>{iso(hitEnd)}</Text>
                </TouchableOpacity>
            </View>

            {hitShowStart && <DateTimePicker value={hitStart} mode="date" onChange={(_, d) => { setHitShowStart(false); if(d) setHitStart(d); }} />}
            {hitShowEnd && <DateTimePicker value={hitEnd} mode="date" onChange={(_, d) => { setHitShowEnd(false); if(d) setHitEnd(d); }} />}

            {hitLoading && <ActivityIndicator style={{ marginTop: 20 }} />}
            
            {preview && (
              <View style={st.card}>
                <Text style={[st.h3, { marginBottom: 10 }]}>Rincian Gaji</Text>
                <Row label="Nama" value={preview.nama} />
                <Row label="Total Absen" value={`${preview.hadir_minggu} hari`} />
                <Row label="Lembur" value={`${preview.lembur_menit} menit (Rp ${fmtIDR(preview.lembur_rp)})`} />
                <Row label="Potongan Angsuran" value={`- Rp ${fmtIDR(preview.angsuran_rp)}`} isDeduction />

                <View style={st.sep} />
                <Text style={st.label}>Gaji Pokok (Rp)</Text>
                <TextInput style={st.input} keyboardType="numeric" value={gajiPokok} onChangeText={setGajiPokok} />
                <Text style={st.label}>THR (Rp)</Text>
                <TextInput style={st.input} keyboardType="numeric" value={thr} onChangeText={setThr} placeholder="Opsional" />
                <Text style={st.label}>Bonus (Rp)</Text>
                <TextInput style={st.input} keyboardType="numeric" value={bonusAkhirTahun} onChangeText={setBonusAkhirTahun} placeholder="Opsional" />
                <Text style={st.label}>Lainnya</Text>
                {others.map(o => (
                    <View key={o.id} style={{flexDirection:'row', gap:5, marginBottom:5}}>
                        <TextInput style={[st.input, {flex:1}]} placeholder="Ket." value={o.label} onChangeText={v => updOther(o.id, 'label', v)} />
                        <TextInput style={[st.input, {flex:1}]} placeholder="Rp" keyboardType="numeric" value={o.amount} onChangeText={v => updOther(o.id, 'amount', v)} />
                        <TouchableOpacity onPress={() => delOther(o.id)}><Ionicons name="trash" size={24} color="red" style={{marginTop:10}}/></TouchableOpacity>
                    </View>
                ))}
                <TouchableOpacity onPress={addOther}><Text style={{color:C.primary, fontWeight:'bold'}}>+ Tambah Item</Text></TouchableOpacity>

                <View style={st.totalBox}>
                    <Text style={st.totalLabel}>TOTAL DITERIMA</Text>
                    <Text style={st.totalVal}>Rp {fmtIDR(totalHitung)}</Text>
                </View>

                <TouchableOpacity style={st.btnPrimary} onPress={saveHitung} disabled={hitLoading}>
                    <Text style={st.btnText}>SIMPAN SLIP</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* === TAB 2: SLIP GAJI === */}
        {tab === "slip" && (
            <View>
                 <View style={st.segmentWrap}>
                    <TouchableOpacity onPress={() => setSlipPeriodMode("week")} style={[st.segmentBtn, slipPeriodMode === "week" && st.segmentActive]}>
                        <Text style={[st.segmentTx, slipPeriodMode === "week" && st.segmentTxActive]}>Mingguan</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setSlipPeriodMode("month")} style={[st.segmentBtn, slipPeriodMode === "month" && st.segmentActive]}>
                        <Text style={[st.segmentTx, slipPeriodMode === "month" && st.segmentTxActive]}>Bulanan (Akumulasi)</Text>
                    </TouchableOpacity>
                </View>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                    {slipPeriodMode === 'week' ? (
                        <>
                             <TouchableOpacity style={st.inputBtn} onPress={() => setSlipShowStart(true)}>
                                <Text>{iso(slipStart)}</Text>
                            </TouchableOpacity>
                            <Text style={{alignSelf:'center'}}>s/d</Text>
                            <TouchableOpacity style={st.inputBtn} onPress={() => setSlipShowEnd(true)}>
                                <Text>{iso(slipEnd)}</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <TouchableOpacity style={[st.inputBtn, {flex:1}]} onPress={() => setSlipShowMonthPicker(true)}>
                            <Text style={{textAlign:'center'}}>{monthLabelID(slipMonthAnchor)}</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {slipShowStart && <DateTimePicker value={slipStart} mode="date" onChange={(_, d) => { setSlipShowStart(false); if(d) setSlipStart(d); }} />}
                {slipShowEnd && <DateTimePicker value={slipEnd} mode="date" onChange={(_, d) => { setSlipShowEnd(false); if(d) setSlipEnd(d); }} />}
                {slipShowMonthPicker && <DateTimePicker value={slipMonthAnchor} mode="date" onChange={(_, d) => { 
                    setSlipShowMonthPicker(false); 
                    if(d) {
                        setSlipMonthAnchor(d);
                        setSlipStart(startOfMonth(d));
                        setSlipEnd(endOfMonth(d));
                    } 
                }} />}

                <View style={{flexDirection:'row', gap:10, marginTop:10}}>
                     <TouchableOpacity style={[st.select, {flex:1}]} onPress={() => setUserModal({visible:true, target:"slip"})}>
                        <Text>{slipUser ? slipUser.nama : "Semua Karyawan"}</Text>
                     </TouchableOpacity>
                     <TouchableOpacity style={[st.btnPrimary, {marginTop:0, width:100}]} onPress={() => {
                         setSlipMode(slipUser ? "single" : "all");
                         loadSlip();
                     }}>
                        <Text style={st.btnText}>Cari</Text>
                     </TouchableOpacity>
                </View>

                {slipLoading && <ActivityIndicator style={{ marginTop: 20 }} />}
                
                {/* Mode: LIST SEMUA */}
                {slipMode === 'all' && slipList.length > 0 && (
                    <View style={{marginTop:15}}>
                         <TouchableOpacity style={st.btnGhost} onPress={exportSlipListPDF}>
                            <Text style={st.btnGhostText}>Cetak PDF Laporan</Text>
                         </TouchableOpacity>

                         {slipList.map((item, idx) => (
                             <GajiDetailCard key={idx} item={item} />
                         ))}
                    </View>
                )}

                {/* Mode: SINGLE SLIP */}
                {slipMode === 'single' && slip && (
                    <View style={{marginTop: 20}}>
                         <GajiDetailCard item={slip} />
                         <View style={{marginTop:10, gap:10}}>
                             {slip.status_bayar !== 'paid' && (
                                 <TouchableOpacity style={st.btnPrimary} onPress={() => updateSlipStatus("paid")}>
                                    <Text style={st.btnText}>Tandai Sudah Transfer</Text>
                                 </TouchableOpacity>
                             )}
                             <TouchableOpacity style={st.btnGhost} onPress={() => htmlToPdfAndShare("slip.pdf", "<h1>Detail PDF Logic Here</h1>")}>
                                 <Text style={st.btnGhostText}>Unduh PDF</Text>
                             </TouchableOpacity>
                         </View>
                    </View>
                )}
            </View>
        )}

        {/* === TAB 3: ARSIP (FULL UI) === */}
        {tab === "arsip" && (
            <View>
                 <Text style={st.label}>Filter Karyawan</Text>
                 <TouchableOpacity style={st.select} onPress={() => setUserModal({ visible: true, target: "arsip" })}>
                    <Text style={st.selectTx}>{arsipUser ? arsipUser.nama : "Semua Karyawan"}</Text>
                    <Ionicons name="chevron-down" size={20} color={C.muted} />
                </TouchableOpacity>

                <Text style={st.label}>Rentang Waktu</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity style={st.inputBtn} onPress={() => setArsipShowStart(true)}>
                        <Text>{iso(arsipStart)}</Text>
                    </TouchableOpacity>
                    <Text style={{ alignSelf: 'center' }}>s/d</Text>
                    <TouchableOpacity style={st.inputBtn} onPress={() => setArsipShowEnd(true)}>
                        <Text>{iso(arsipEnd)}</Text>
                    </TouchableOpacity>
                </View>

                {arsipShowStart && <DateTimePicker value={arsipStart} mode="date" onChange={(_, d) => { setArsipShowStart(false); if(d) setArsipStart(d); }} />}
                {arsipShowEnd && <DateTimePicker value={arsipEnd} mode="date" onChange={(_, d) => { setArsipShowEnd(false); if(d) setArsipEnd(d); }} />}

                <TouchableOpacity style={st.btnPrimary} onPress={loadArsip} disabled={arsipLoading}>
                    <Text style={st.btnText}>{arsipLoading ? "Memuat..." : "Tampilkan Arsip"}</Text>
                </TouchableOpacity>

                {arsip.length > 0 && (
                    <View style={{ marginTop: 20 }}>
                         <TouchableOpacity style={st.btnGhost} onPress={exportArsipPDF}>
                            <Text style={st.btnGhostText}>Unduh Laporan PDF</Text>
                        </TouchableOpacity>

                        {/* 🔥 PAKAI GajiDetailCard BIAR TAMPIL LENGKAP 🔥 */}
                        {arsip.map((item, idx) => (
                            <GajiDetailCard key={idx} item={item} />
                        ))}
                    </View>
                )}
                {!arsipLoading && arsip.length === 0 && <Text style={{textAlign:'center', marginTop:20, color:C.muted}}>Tidak ada data arsip.</Text>}
            </View>
        )}

      </ScrollView>

      {/* Modal User */}
      <Modal visible={userModal.visible} transparent animationType="slide">
        <View style={st.modalWrap}>
            <View style={st.modalBox}>
                <Text style={st.h3}>Pilih Karyawan</Text>
                <FlatList 
                    data={[{id:0, nama:"Semua Karyawan"}, ...users]}
                    keyExtractor={i => String(i.id)}
                    renderItem={({item}) => (
                        <TouchableOpacity style={{padding:15, borderBottomWidth:1, borderColor:'#eee'}} onPress={() => {
                            if (userModal.target === 'hitung') setHitUser(item.id===0 ? null : item);
                            if (userModal.target === 'slip') setSlipUser(item.id===0 ? null : item);
                            if (userModal.target === 'arsip') setArsipUser(item.id===0 ? null : item);
                            setUserModal(p => ({...p, visible:false}));
                        }}>
                            <Text>{item.nama}</Text>
                        </TouchableOpacity>
                    )}
                />
                <TouchableOpacity onPress={() => setUserModal(p => ({...p, visible:false}))} style={{padding:15, alignItems:'center'}}>
                    <Text style={{color:'red'}}>Tutup</Text>
                </TouchableOpacity>
            </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ===== Styles =====
const st = StyleSheet.create({
  headerWrap: { padding: 16, backgroundColor: C.primary, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  title: { fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 10 },
  tabs: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, padding: 4 },
  tabBtn: { flex: 1, padding: 10, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: "#fff" },
  tabTx: { color: "#e0e0e0", fontWeight: "600" },
  tabTxActive: { color: C.primary, fontWeight: "bold" },
  
  body: { padding: 16 },
  label: { fontWeight: "700", marginVertical: 8, color: C.text },
  h3: { fontWeight: "900", color: C.text, fontSize: 16 },
  
  select: { padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: "#fff", flexDirection:'row', justifyContent:'space-between' },
  selectTx: { color: C.text },
  inputBtn: { padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: "#fff", flex:1, alignItems:'center' },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10, backgroundColor: "#fff", marginBottom: 10 },
  
  card: { backgroundColor: "#fff", padding: 16, borderRadius: 12, elevation: 3, marginBottom: 10 },
  sep: { height: 1, backgroundColor: "#eee", marginVertical: 10 },
  
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  rowLabel: { color: C.muted },
  rowVal: { fontWeight: "600", color: C.text },
  
  totalBox: { backgroundColor: C.primarySoft, padding: 15, borderRadius: 10, marginTop: 10, alignItems:'center' },
  totalLabel: { color: C.primaryDark, fontWeight: "bold" },
  totalVal: { fontSize: 20, fontWeight: "900", color: C.primaryDark },

  btnPrimary: { backgroundColor: C.primary, padding: 14, borderRadius: 10, alignItems: "center", marginTop: 15 },
  btnText: { color: "#fff", fontWeight: "bold" },
  
  btnGhost: { borderWidth:1, borderColor:C.primary, padding: 12, borderRadius: 10, alignItems: "center", marginBottom: 10 },
  btnGhostText: { color: C.primary, fontWeight: "bold" },

  segmentWrap: { flexDirection:'row', backgroundColor:'#eee', borderRadius:8, padding:4, marginBottom:10 },
  segmentBtn: { flex:1, padding:8, alignItems:'center', borderRadius:6 },
  segmentActive: { backgroundColor:'#fff', elevation:2 },
  segmentTx: { color:'#888' },
  segmentTxActive: { color:C.primary, fontWeight:'bold' },

  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#fff", padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight:'70%' },
});