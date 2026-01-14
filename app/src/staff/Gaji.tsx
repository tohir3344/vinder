import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  Pressable,
  Platform
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE as RAW_API_BASE } from "../../config";

/* =================== CONFIG & THEME =================== */
const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";
const API_SLIP = `${API_BASE}gaji/gaji_slip.php`;
const API_PREVIEW = `${API_BASE}gaji/gaji_preview.php`;

const C = {
  primary: "#A51C24",
  primaryDark: "#8B181F",
  primarySoft: "#FFF1F2",
  text: "#1F2937",
  muted: "#6B7280",
  border: "#E5E7EB",
  bg: "#F9FAFB",
  card: "#FFFFFF",
  green: "#059669",
  red: "#DC2626",
  orange: "#D97706",
  yellowBg: "#FEF3C7",
  yellowText: "#B45309",
  blueBg: "#EFF6FF",
  blueText: "#1D4ED8"
};

/* =================== HELPERS =================== */
const iso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfWeek = (d) => {
  const x = new Date(d);
  const dow = x.getDay();
  let diff = (dow + 1) % 7;
  if (dow === 6) { diff = 7; }
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfWeek = (d) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
};

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

function fmtIDR(n) {
  return Number(n ?? 0).toLocaleString("id-ID");
}

function parseOthers(row) {
  if (!row || !row.others_json) return [];
  let raw = row.others_json;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => ({
    label: String(o.label ?? "Lainnya"),
    amount: parseInt(String(o.amount ?? 0), 10)
  })).filter(o => o.amount > 0);
}

/* =================== MAIN COMPONENT =================== */
export default function GajiUser() {
  const [myId, setMyId] = useState(null);
  const [myName, setMyName] = useState("");
  const [mode, setMode] = useState("week");

  const now = useMemo(() => new Date(), []);
  const [start, setStart] = useState(startOfWeek(now));
  const [end, setEnd] = useState(endOfWeek(now));

  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);

  const [loading, setLoading] = useState(false);
  const [slip, setSlip] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const othersItems = slip ? parseOthers(slip) : [];
  const isSaturday = now.getDay() === 6;

  // 1. Get User Session
  useEffect(() => {
    (async () => {
      try {
        const keys = ["auth", "user", "current_user", "session"];
        let found = null;
        for (const k of keys) {
          const v = await AsyncStorage.getItem(k);
          if (v) { found = JSON.parse(v); break; }
        }
        if (found) {
          setMyId(Number(found.id ?? found.user_id ?? 0));
          setMyName(String(found.name ?? found.nama ?? ""));
        }
      } catch (e) { }
    })();
  }, []);

  // 2. Auto Date Range
  useEffect(() => {
    if (mode === "week") {
      const d = new Date();
      setStart(startOfWeek(d));
      setEnd(endOfWeek(d));
    } else {
      const d = new Date();
      setStart(startOfMonth(d));
      setEnd(endOfMonth(d));
    }
  }, [mode]);

  // 3. Fetch Data Logic
  const fetchSlip = async () => {
    if (!myId) return;
    const startStr = iso(start);
    const endStr = iso(end);

    try {
      setLoading(true);

      // A. Cek Data Tersimpan (Database History)
      const urlSlip = `${API_SLIP}?user_id=${myId}&start=${startStr}&end=${endStr}&mode=${mode}`;
      const rSlip = await fetch(urlSlip);
      const jSlip = await rSlip.json();
      const saved = (jSlip?.success && jSlip?.data?.[0]) ? jSlip.data[0] : null;

      if (saved && saved.status_bayar === 'paid') {
        const hadir = Number(saved.hadir_minggu || 0);
        const gpTotal = Number(saved.gaji_pokok_rp || 0);
        let harian = Number(saved.gaji_pokok_harian || saved.nominal_dasar || 0);
        if (harian === 0 && hadir > 0) {
          harian = gpTotal / hadir;
        }

        setSlip({
          ...saved,
          hadir_minggu: hadir,
          gaji_pokok_rate: harian,
          total_telat: Number(saved.total_telat || 0)
        });

      } else {
        // B. Preview Live
        const urlPrev = `${API_PREVIEW}?user_id=${myId}&start=${startStr}&end=${endStr}`;
        const rPrev = await fetch(urlPrev);
        const jPrev = await rPrev.json();
        const live = jPrev?.success ? jPrev.data : null;

        if (live) {
          setSlip({
            user_id: myId,
            nama: live.nama || myName,
            periode_start: startStr,
            periode_end: endStr,
            hadir_minggu: Number(live.hadir_minggu || 0),
            total_telat: Number(live.total_telat || 0),
            potongan_telat_rp: Number(live.potongan_telat_rp || 0),
            lembur_menit: Number(live.lembur_menit || 0),
            lembur_rp: Number(live.lembur_rp || 0),
            gaji_pokok_rp: Number(live.total_gaji_pokok || 0),
            gaji_pokok_rate: Number(live.nominal_dasar || 0),
            angsuran_rp: Number(live.angsuran_rp || 0),
            bonus_bulanan_rp: Number(live.bonus_bulanan || 0),
            total_gaji_rp: Number(live.total_diterima || 0),
            is_preview: true,
            status_bayar: 'unpaid'
          });
        } else {
          setSlip(saved ? { ...saved, is_preview: true } : null);
        }
      }
    } catch (e) { setSlip(null); } finally { setLoading(false); }
  };

  useEffect(() => { fetchSlip(); }, [myId, start, end, mode]);

  const onRefresh = async () => { setRefreshing(true); await fetchSlip(); setRefreshing(false); };

  /* =================== UI RENDER =================== */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={st.headerContainer}>
        <View style={st.headerRow}>
          <View>
            <Text style={st.headerSubtitle}>Rincian Penghasilan</Text>
            <Text style={st.headerTitle}>Gaji & Tunjangan</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={st.iconBtn} onPress={() => setShowInfo(true)}>
              <Ionicons name="information-circle-outline" size={24} color="#FFF" />
            </TouchableOpacity>
            <TouchableOpacity style={st.iconBtn} onPress={onRefresh}>
              <Ionicons name="refresh" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Total Card */}
        <View style={st.totalCard}>
          <Text style={st.totalLabel}>
            {slip?.is_preview ? "Estimasi Gaji Sementara" : "Total Gaji Diterima"}
          </Text>

          {loading && !refreshing ? (
            <ActivityIndicator color={C.primary} style={{ marginVertical: 10 }} />
          ) : (
            <Text style={st.totalValue}>Rp {fmtIDR(slip?.total_gaji_rp ?? 0)}</Text>
          )}

          <View style={st.periodBadge}>
            <Text style={st.periodText}>{(slip?.periode_start || iso(start))} s/d {(slip?.periode_end || iso(end))}</Text>
          </View>

          {!slip?.is_preview && slip?.status_bayar === 'paid' ? (
            <View style={st.paidBadge}>
              <Ionicons name="checkmark-circle" size={16} color={C.green} />
              <Text style={st.paidText}>SUDAH DITRANSFER</Text>
            </View>
          ) : (
            <View style={[st.paidBadge, { backgroundColor: '#FFF7ED' }]}>
              <Ionicons name="time-outline" size={16} color={C.orange} />
              <Text style={[st.paidText, { color: C.orange }]}>PENDING / ESTIMASI</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={st.body}
        contentContainerStyle={{ paddingBottom: 50 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Banner Info */}
        {isSaturday && mode === 'week' && (
          <View style={st.infoBanner}>
            <Ionicons name="information-circle" size={22} color={C.yellowText} />
            <Text style={st.infoBannerText}>
              Hari ini <Text style={{ fontWeight: 'bold' }}>Sabtu (Gajian)</Text>. Data mingguan direset besok (Minggu).
            </Text>
          </View>
        )}

        {/* Filter Section */}
        <View style={st.sectionHeader}><Text style={st.sectionTitle}>Filter Periode</Text></View>
        <View style={st.periodSelector}>
          <TouchableOpacity onPress={() => setMode("week")} style={[st.periodBtn, mode === "week" && st.periodBtnActive]}>
            <Text style={[st.periodBtnText, mode === "week" && st.periodBtnTextActive]}>Mingguan</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("month")} style={[st.periodBtn, mode === "month" && st.periodBtnActive]}>
            <Text style={[st.periodBtnText, mode === "month" && st.periodBtnTextActive]}>Bulanan</Text>
          </TouchableOpacity>
        </View>

        <View style={st.datePickerRow}>
          <TouchableOpacity style={st.dateBtn} onPress={() => setShowStart(true)}>
            <Ionicons name="calendar-outline" size={16} color={C.muted} />
            <Text style={st.dateText}>{iso(start)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.dateBtn} onPress={() => setShowEnd(true)}>
            <Ionicons name="calendar-outline" size={16} color={C.muted} />
            <Text style={st.dateText}>{iso(end)}</Text>
          </TouchableOpacity>
        </View>

        {showStart && <DateTimePicker value={start} mode="date" display="default" onChange={(e, d) => { setShowStart(false); if (d) setStart(d); }} />}
        {showEnd && <DateTimePicker value={end} mode="date" display="default" onChange={(e, d) => { setShowEnd(false); if (d) setEnd(d); }} />}

        {/* Detail Section */}
        <View style={[st.sectionHeader, { marginTop: 20 }]}><Text style={st.sectionTitle}>Rincian Penerimaan</Text></View>

        <View style={st.detailCard}>
          {slip?.is_preview && (
            <View style={st.previewBanner}>
              <Ionicons name="alert-circle-outline" size={18} color={C.orange} />
              <Text style={st.previewText}>Angka ini adalah estimasi dari Absen & Data User Terbaru.</Text>
            </View>
          )}

          <RowItem label="Kehadiran" value={`${slip?.hadir_minggu ?? 0} Hari`} icon="calendar" color={C.primary} />
          <RowItem label="Total Telat" value={`${slip?.total_telat ?? 0} Kali`} icon="alert-circle-outline" color={C.red} />
          <RowItem label="Gaji Pokok (Total)" value={`Rp ${fmtIDR(slip?.gaji_pokok_rp)}`} icon="wallet" color={C.green} isBold />
          <RowItem label="Gaji Pokok Harian" value={`Rp ${fmtIDR(slip?.gaji_pokok_rate)}`} icon="pricetag" color={C.muted} />
          <RowItem label="Lembur" value={`Rp ${fmtIDR(slip?.lembur_rp)}`} icon="time" color={C.orange} />
          <RowItem label="Bonus Bulanan" value={`Rp ${fmtIDR(slip?.bonus_bulanan_rp)}`} icon="gift" color={C.primary} />

          {othersItems.map((o, idx) => (
            <RowItem key={idx} label={o.label} value={`Rp ${fmtIDR(o.amount)}`} icon="add-circle" color={C.primary} />
          ))}

          <View style={st.divider} />

          <Text style={{ fontSize: 12, fontWeight: 'bold', color: C.muted, marginBottom: 8 }}>POTONGAN</Text>
          <RowItem
            label="Denda Telat"
            value={`- Rp ${fmtIDR(slip?.potongan_telat_rp)}`}
            subValue={slip?.total_telat ? `${slip.total_telat} x 20.000` : ""}
            icon="close-circle" color={C.red}
          />
          <RowItem
            label="Angsuran"
            value={`- Rp ${fmtIDR(slip?.angsuran_rp)}`}
            icon="card" color={C.red} isBold
          />

          <View style={st.totalBox}>
            <Text style={st.totalLabelBox}>Total Bersih</Text>
            <Text style={st.totalValueBox}>Rp {fmtIDR(slip?.total_gaji_rp)}</Text>
          </View>
        </View>
      </ScrollView>

      {/* ======================================================== */}
      {/* 🔥 MODAL INFO GAJI (YANG DIPERBAIKI LEBIH LENGKAP) 🔥 */}
      {/* ======================================================== */}
      <Modal transparent visible={showInfo} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={st.modalOverlay}>
          <View style={st.modalBox}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>Informasi Gaji</Text>
              <Pressable onPress={() => setShowInfo(false)}><Ionicons name="close" size={24} color="#666" /></Pressable>
            </View>

            <ScrollView style={{ maxHeight: 400 }}>
              {/* Section 1 */}
              <View style={st.modalSection}>
                <Text style={st.modalSecTitle}>💰 Komponen Pemasukan</Text>
                <InfoBullet text="Gaji Pokok dihitung dari: (Jumlah Hari Hadir x Tarif Harian)." />
                <InfoBullet text="Bonus Bulanan: 200rb (0 Bolos) atau 100rb (1 Bolos). Jika > 1 Bolos, bonus hangus." />
                <InfoBullet text="Lembur dihitung otomatis berdasarkan jam masuk/keluar di luar shift." />
              </View>

              {/* Section 2 */}
              <View style={st.modalSection}>
                <Text style={st.modalSecTitle}>💸 Potongan & Denda</Text>
                <InfoBullet text="Terlambat Masuk (> 08:00 WIB) dikenakan denda Rp 20.000 per kejadian." />
                <InfoBullet text="Angsuran/Kasbon dipotong otomatis sebesar Rp 300.000 (flat) atau sisa hutang jika < 300rb." />
              </View>

              {/* Section 3 */}
              <View style={st.modalSection}>
                <Text style={st.modalSecTitle}>⚠️ Catatan Sistem</Text>
                <InfoBullet text="Data absen hari ini baru masuk hitungan besok (Cut-off H+1)." />
                <InfoBullet text="Status 'Pending' artinya angka masih bisa berubah sampai di-approve Admin." />
              </View>
            </ScrollView>

            <Pressable onPress={() => setShowInfo(false)} style={st.modalBtnFull}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Tutup Informasi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* =================== SUB COMPONENTS =================== */
function RowItem({ label, value, subValue, icon, color, isBold }) {
  return (
    <View style={st.row}>
      <View style={st.rowLeft}>
        <View style={[st.iconBox, { backgroundColor: color + '15' }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        <Text style={st.rowLabel}>{label}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[st.rowValue, isBold && { fontWeight: 'bold', color: color }]}>{value}</Text>
        {subValue ? <Text style={st.rowSubValue}>{subValue}</Text> : null}
      </View>
    </View>
  );
}

function InfoBullet({ text }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 8 }}>
      <Text style={{ fontSize: 14, color: '#6B7280', marginRight: 6 }}>•</Text>
      <Text style={{ fontSize: 13, color: '#374151', lineHeight: 20, flex: 1 }}>{text}</Text>
    </View>
  );
}

/* =================== STYLES =================== */
const st = StyleSheet.create({
  headerContainer: { backgroundColor: C.primary, paddingTop: 30, paddingBottom: 30, paddingHorizontal: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: C.primarySoft, marginBottom: 2 },
  iconBtn: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 8, borderRadius: 12 },

  totalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, alignItems: 'center', elevation: 5, marginBottom: -40, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  totalLabel: { fontSize: 14, color: C.muted, fontWeight: '600' },
  totalValue: { fontSize: 28, fontWeight: 'bold', color: C.primary, marginVertical: 4 },
  periodBadge: { backgroundColor: C.bg, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 5 },
  periodText: { fontSize: 12, color: C.text },
  paidBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 10, gap: 5 },
  paidText: { fontSize: 12, fontWeight: 'bold', color: C.green },

  body: { marginTop: 50, paddingHorizontal: 20 },
  infoBanner: { backgroundColor: C.yellowBg, padding: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 20, borderWidth: 1, borderColor: '#FDE047' },
  infoBannerText: { color: C.yellowText, fontSize: 12, flex: 1, lineHeight: 18 },

  sectionHeader: { marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: C.text },

  periodSelector: { flexDirection: 'row', backgroundColor: '#fff', padding: 4, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  periodBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  periodBtnActive: { backgroundColor: C.primarySoft },
  periodBtnText: { color: C.muted, fontWeight: '600' },
  periodBtnTextActive: { color: C.primary, fontWeight: 'bold' },

  datePickerRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  dateBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  dateText: { fontWeight: '600', color: C.text },

  detailCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 10, borderWidth: 1, borderColor: C.border },
  previewBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF7ED', padding: 10, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#FFEDD5' },
  previewText: { fontSize: 12, color: C.orange, flex: 1 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, color: C.muted },
  rowValue: { fontSize: 14, fontWeight: '600', color: C.text },
  rowSubValue: { fontSize: 11, color: C.muted, textAlign: 'right' },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 10 },

  totalBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  totalLabelBox: { fontSize: 16, fontWeight: 'bold', color: C.text },
  totalValueBox: { fontSize: 18, fontWeight: 'bold', color: C.primary },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalBox: { backgroundColor: "#fff", borderRadius: 16, width: "100%", maxWidth: 340, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 10 },
  modalTitle: { fontWeight: "800", fontSize: 18, color: "#111827" },
  modalBtnFull: { backgroundColor: C.primary, width: '100%', alignItems: 'center', paddingVertical: 12, borderRadius: 10, marginTop: 15 },

  modalSection: { marginBottom: 15, backgroundColor: '#F9FAFB', padding: 10, borderRadius: 8 },
  modalSecTitle: { fontSize: 14, fontWeight: 'bold', color: C.primary, marginBottom: 8 },
});