// app/user/GajiUser.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { API_BASE as RAW_API_BASE } from "../../config";

/* =================== CONFIG & THEME =================== */
const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";
const API_SLIP = `${API_BASE}gaji/gaji_slip.php`;
const API_PREVIEW = `${API_BASE}gaji/gaji_preview.php`;

const C = {
  primary: "#2196F3", 
  primaryDark: "#1565C0",
  primarySoft: "#E3F2FD",
  text: "#1F2937",
  muted: "#6B7280",
  border: "#E5E7EB",
  bg: "#F3F4F6",
  card: "#FFFFFF",
  green: "#10B981",
  red: "#EF4444",
  orange: "#F59E0B",
};

/* =================== HELPERS =================== */
const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); 
  const diffToMonday = (dow + 6) % 7;
  x.setDate(x.getDate() - diffToMonday);
  return x;
};
const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

function fmtIDR(n?: number | null) {
  return Number(n ?? 0).toLocaleString("id-ID");
}

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

/* =================== TYPES =================== */
type Slip = {
  id?: number;
  user_id: number;
  nama: string;
  periode_start: string;
  periode_end: string;
  hadir_minggu: number; 
  lembur_menit: number;
  lembur_rp: number;
  
  gaji_pokok_rp: number; // Total (Hasil kali)
  gaji_pokok_rate?: number; // Rate Harian (Opsional buat info)

  angsuran_rp: number;
  thr_rp?: number | null;
  bonus_akhir_tahun_rp?: number | null;
  others_total_rp?: number | null;
  kerajinan_rp?: number | null;
  kebersihan_rp?: number | null;
  ibadah_rp?: number | null;
  others_json?: any;
  total_gaji_rp: number;
  status_bayar?: string;
  is_preview?: boolean; 
};

/* =================== MAIN =================== */
export default function GajiUser() {
  const [myId, setMyId] = useState<number | null>(null);
  const [myName, setMyName] = useState<string>("");
  const [mode, setMode] = useState<"week" | "month">("week");

  const now = useMemo(() => new Date(), []);
  const [start, setStart] = useState<Date>(startOfWeek(now));
  const [end, setEnd] = useState<Date>(endOfWeek(now));
  const [monthAnchor, setMonthAnchor] = useState<Date>(new Date());

  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const [loading, setLoading] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const othersItems = slip ? parseOthers(slip) : [];

  useEffect(() => {
    (async () => {
      try {
        const keys = ["auth", "user", "current_user", "session"];
        let found: any = null;
        for (const k of keys) {
          const v = await AsyncStorage.getItem(k);
          if (!v) continue;
          try {
            const j = JSON.parse(v);
            if (j && typeof j === "object") { found = j; break; }
          } catch {}
        }
        let id: number | null = null;
        let nama = "";
        if (found) {
          id = Number(found.id ?? found.user_id ?? 0);
          nama = String(found.name ?? found.nama ?? found.nama_lengkap ?? "");
        }
        if (!id || id <= 0) {
          Alert.alert("Error", "ID pengguna tidak ditemukan.");
          return;
        }
        setMyId(id);
        setMyName(nama || `User#${id}`);
      } catch (e: any) {
        Alert.alert("Error", e.message || String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (mode === "week") {
      const d = new Date();
      setStart(startOfWeek(d));
      setEnd(endOfWeek(d));
    } else {
      const d = new Date();
      setMonthAnchor(d);
      setStart(startOfMonth(d));
      setEnd(endOfMonth(d));
    }
  }, [mode]);

  const fetchSlip = async () => {
    if (!myId) return;
    const startStr = iso(start);
    const endStr = iso(end);

    try {
      setLoading(true);

      // 1. TARIK DATA LIVE (Murni dari Absen)
      // Ini biar jumlah hari hadir & lembur selalu UPDATE DETIK ITU JUGA
      const urlPrev = `${API_PREVIEW}?user_id=${myId}&start=${startStr}&end=${endStr}`;
      const rPrev = await fetch(urlPrev);
      const jPrev = await rPrev.json();
      const liveData = jPrev?.success ? jPrev.data : {};

      // 2. TARIK DATA ADMIN (Yg udah disave)
      // Ini cuma buat ngambil settingan THR, Bonus, atau Potongan Admin
      const urlSlip = `${API_SLIP}?user_id=${myId}&start=${startStr}&end=${endStr}&mode=${mode}`;
      const rSlip = await fetch(urlSlip);
      const jSlip = await rSlip.json();
      const savedData = (jSlip?.success && jSlip?.data?.[0]) ? jSlip.data[0] : null;

      // === LOGIKA PENGGABUNGAN (AUTO UPDATE) ===
      
      if (savedData) {
        // SKENARIO A: Admin udah pernah save (misal kasih THR/Bonus)
        
        // Kalo statusnya udah PAID (Lunas), tampilin apa adanya (jangan diubah lagi)
        if (savedData.status_bayar === 'paid') {
           setSlip(savedData);
           return;
        }

        // 1. Cari tau "Rate Gaji Per Hari" dari save-an Admin terakhir
        const savedHadir = Number(savedData.hadir_minggu || 0);
        const savedGP = Number(savedData.gaji_pokok_rp || 0);
        // Kalau savedHadir 0, pake rate dari data live aja
        const ratePerHari = savedHadir > 0 ? (savedGP / savedHadir) : 0;

        // 2. Ambil Absen TERBARU dari Live Data
        const currentHadir = Number(liveData.hadir_minggu || 0); 
        const currentLemburRp = Number(liveData.lembur_rp || 0);
        const currentLemburMnt = Number(liveData.lembur_menit || 0);

        // 3. HITUNG ULANG GAJI POKOK (Rate Admin x Absen Live)
        // Ini yg bikin user gak perlu nunggu admin save ulang.
        // Absen nambah -> Gaji Pokok nambah otomatis.
        let realTimeGajiPokok = 0;
        if (ratePerHari > 0) {
            realTimeGajiPokok = ratePerHari * currentHadir;
        } else {
            // Fallback kalo admin save pas kehadiran 0, pake rate master data
            const masterRate = Number(liveData.gaji_pokok_rp || 0) / (Number(liveData.hadir_minggu)||1);
            realTimeGajiPokok = masterRate * currentHadir;
        }

        // 4. Ambil Tambahan dari Admin
        const thr = Number(savedData.thr_rp || 0);
        const bonus = Number(savedData.bonus_akhir_tahun_rp || 0);
        const others = Number(savedData.others_total_rp || 0);
        const angsuran = Number(savedData.angsuran_rp || 0); 

        // 5. Total Ulang
        const totalBaru = realTimeGajiPokok + currentLemburRp + thr + bonus + others - angsuran;

        setSlip({
            ...savedData, // Bawa ID slip lama
            
            // TIMPA data lama dengan data LIVE
            hadir_minggu: currentHadir,
            lembur_menit: currentLemburMnt,
            lembur_rp: currentLemburRp,
            
            gaji_pokok_rp: realTimeGajiPokok,
            gaji_pokok_rate: ratePerHari || (realTimeGajiPokok/currentHadir),

            total_gaji_rp: totalBaru, 
            
            // Kasih tanda ini preview karena angkanya masih gerak terus
            is_preview: true 
        } as Slip);

      } else {
        // SKENARIO B: Admin belum sentuh sama sekali
        // Full pake data Live Preview
        
        const rateGaji = Number(liveData.gaji_pokok_rp ?? 0); // Biasanya ini rate * hadir di PHP
        const hadir = Number(liveData.hadir_minggu ?? 0);
        
        // Kita hitung manual biar aman: (Rate/Hadir) * Hadir ?? 
        // Atau ambil mentah dari API preview kalo API preview balikin total.
        // Asumsi API Preview balikin rate harian di gaji_pokok_rp (berdasarkan kode lu sblmnya agak rancu,
        // jadi mending kita hitung manual estimasinya):
        
        // NOTE: Pastikan API preview balikin gaji_pokok_rp sebagai RATE harian atau TOTAL.
        // Kalau logic sblmnya: const estimasiGajiPokok = rateGaji * hadir;
        // Berarti rateGaji dr API itu Rate Harian.
        const estimasiGajiPokok = rateGaji * hadir;
        
        // Auto Angsuran Logic
        const sisaUtang = Number(liveData.angsuran_rp ?? 0);
        let estimasiPotongan = 0;
        if (sisaUtang >= 300000) estimasiPotongan = 300000;
        else if (sisaUtang > 0) estimasiPotongan = sisaUtang;

        const lemburRp = Number(liveData.lembur_rp ?? 0);
        const total = estimasiGajiPokok + lemburRp - estimasiPotongan;

        setSlip({
          user_id: myId,
          nama: String(liveData.nama ?? myName),
          periode_start: String(liveData.periode_start ?? startStr),
          periode_end: String(liveData.periode_end ?? endStr),
          hadir_minggu: hadir,
          lembur_menit: Number(liveData.lembur_menit ?? 0),
          lembur_rp: lemburRp,
          
          gaji_pokok_rp: estimasiGajiPokok,
          gaji_pokok_rate: rateGaji,
          
          angsuran_rp: estimasiPotongan,
          thr_rp: 0,
          bonus_akhir_tahun_rp: 0,
          others_total_rp: 0,
          total_gaji_rp: total,
          
          is_preview: true,
          status_bayar: 'unpaid'
        });
      }

    } catch (e) {
      console.log("fetchSlip error", e);
      setSlip(null);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSlip();
    setRefreshing(false);
  };

  /* =================== UI =================== */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={st.headerContainer}>
          <View style={st.headerRow}>
              <View>
                  <Text style={st.headerSubtitle}>Rincian Penghasilan</Text>
                  <Text style={st.headerTitle}>Gaji & Tunjangan</Text>
              </View>
              <TouchableOpacity style={st.refreshBtn} onPress={onRefresh}>
                  <Ionicons name="refresh" size={20} color="#fff" />
              </TouchableOpacity>
          </View>

          {/* CARD TOTAL GAJI */}
          <View style={st.totalCard}>
              <Text style={st.totalLabel}>
                  {slip?.is_preview ? "Estimasi Gaji Sementara" : "Total Gaji Diterima"}
              </Text>
              {loading ? (
                  <ActivityIndicator color={C.primary} style={{ marginVertical: 10 }} />
              ) : (
                  <Text style={st.totalValue}>Rp {fmtIDR(slip?.total_gaji_rp ?? 0)}</Text>
              )}
              <View style={st.periodBadge}>
                  <Text style={st.periodText}>
                      {(slip?.periode_start || iso(start))} s/d {(slip?.periode_end || iso(end))}
                  </Text>
              </View>

              {/* Badge Status */}
              {!slip?.is_preview && slip?.status_bayar === 'paid' ? (
                  <View style={st.paidBadge}>
                      <Ionicons name="checkmark-circle" size={16} color={C.green} />
                      <Text style={st.paidText}>SUDAH DITRANSFER</Text>
                  </View>
              ) : slip?.is_preview ? (
                  <View style={[st.paidBadge, {backgroundColor:'#FFF7ED'}]}>
                       <Ionicons name="time-outline" size={16} color={C.orange} />
                       <Text style={[st.paidText, {color:C.orange}]}>MENUNGGU KONFIRMASI ADMIN</Text>
                  </View>
              ) : (
                   <View style={[st.paidBadge, {backgroundColor:'#F3F4F6'}]}>
                       <Text style={[st.paidText, {color:C.muted}]}>BELUM DIBAYAR</Text>
                  </View>
              )}
          </View>
      </View>

      <ScrollView 
        style={st.body}
        contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
          <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Filter Periode</Text>
          </View>

          <View style={st.periodSelector}>
              <TouchableOpacity onPress={() => setMode("week")} style={[st.periodBtn, mode === "week" && st.periodBtnActive]}>
                  <Text style={[st.periodBtnText, mode === "week" && st.periodBtnTextActive]}>Mingguan</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setMode("month")} style={[st.periodBtn, mode === "month" && st.periodBtnActive]}>
                  <Text style={[st.periodBtnText, mode === "month" && st.periodBtnTextActive]}>Bulanan</Text>
              </TouchableOpacity>
          </View>

          <View style={st.datePickerRow}>
              {mode === "week" ? (
                  <>
                      <TouchableOpacity style={st.dateBtn} onPress={() => setShowStart(true)}>
                          <Ionicons name="calendar-outline" size={18} color={C.primary} />
                          <Text style={st.dateText}>{iso(start)}</Text>
                      </TouchableOpacity>
                      <Text style={{ color: C.muted }}>s/d</Text>
                      <TouchableOpacity style={st.dateBtn} onPress={() => setShowEnd(true)}>
                          <Ionicons name="calendar-outline" size={18} color={C.primary} />
                          <Text style={st.dateText}>{iso(end)}</Text>
                      </TouchableOpacity>
                  </>
              ) : (
                  <TouchableOpacity style={st.dateBtnFull} onPress={() => setShowMonthPicker(true)}>
                      <Ionicons name="calendar" size={18} color={C.primary} />
                      <Text style={st.dateText}>
                          {monthAnchor.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                      </Text>
                  </TouchableOpacity>
              )}
          </View>

          {showStart && <DateTimePicker value={start} mode="date" onChange={(e, d) => { setShowStart(false); if(d) { setStart(mode==='week' ? startOfWeek(d) : startOfMonth(d)); setEnd(mode==='week' ? endOfWeek(d) : endOfMonth(d)); }}} />}
          {showEnd && <DateTimePicker value={end} mode="date" onChange={(e, d) => { setShowEnd(false); if(d) { setStart(mode==='week' ? startOfWeek(d) : startOfMonth(d)); setEnd(mode==='week' ? endOfWeek(d) : endOfMonth(d)); }}} />}
          {showMonthPicker && <DateTimePicker value={monthAnchor} mode="date" onChange={(e, d) => { setShowMonthPicker(false); if(d) { setMonthAnchor(d); setStart(startOfMonth(d)); setEnd(endOfMonth(d)); }}} />}

          <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Rincian Penerimaan</Text>
          </View>

          <View style={st.detailCard}>
              {slip?.is_preview && (
                  <View style={st.previewBanner}>
                      <Ionicons name="alert-circle-outline" size={18} color={C.orange} />
                      <Text style={st.previewText}>Ini adalah estimasi. Nominal final bisa berubah saat Admin menyimpan slip.</Text>
                  </View>
              )}

              <RowItem label="Kehadiran" value={`${slip?.hadir_minggu ?? 0} Hari`} icon="calendar" color={C.primary} />
              <RowItem label="Gaji Pokok (Harian)" value={`Rp ${fmtIDR(slip?.gaji_pokok_rate)}`} icon="pricetag" color={C.muted} />
              <RowItem label="Gaji Pokok (Total)" value={`Rp ${fmtIDR(slip?.gaji_pokok_rp)}`} icon="cash" color={C.green} isBold />
              <RowItem label="Lembur" value={`Rp ${fmtIDR(slip?.lembur_rp)}`} subValue={`(${slip?.lembur_menit ?? 0} menit)`} icon="time" color={C.orange} />
              
              {renderOpt("THR", slip?.thr_rp ?? slip?.kerajinan_rp)}
              {renderOpt("Bonus Akhir Tahun", slip?.bonus_akhir_tahun_rp ?? slip?.kebersihan_rp)}
              
              {othersItems.map((o, idx) => (
                  <RowItem key={idx} label={o.label} value={`Rp ${fmtIDR(o.amount)}`} icon="add-circle" color={C.primary} />
              ))}

              <View style={st.divider} />
              <RowItem label="Potongan Angsuran" value={`- Rp ${fmtIDR(slip?.angsuran_rp)}`} icon="remove-circle" color={C.red} isBold />

              <View style={st.totalBox}>
                  <Text style={st.totalLabelBox}>Total Bersih</Text>
                  <Text style={st.totalValueBox}>Rp {fmtIDR(slip?.total_gaji_rp)}</Text>
              </View>
          </View>

          {!loading && !slip && (
              <View style={st.emptyState}>
                  <Ionicons name="file-tray-outline" size={48} color={C.muted} />
                  <Text style={st.emptyText}>Belum ada data aktivitas untuk periode ini.</Text>
              </View>
          )}

      </ScrollView>
    </SafeAreaView>
  );
}

/* =================== COMPONENTS =================== */
function RowItem({ label, value, subValue, icon, color, isBold }: any) {
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
                {subValue && <Text style={st.rowSubValue}>{subValue}</Text>}
            </View>
        </View>
    );
}

function renderOpt(label: string, val?: number | null) {
    if (!val) return null;
    return <RowItem label={label} value={`Rp ${fmtIDR(val)}`} icon="gift" color={C.primary} />;
}

/* =================== STYLES =================== */
const st = StyleSheet.create({
  headerContainer: {
      backgroundColor: C.primary,
      paddingTop: Platform.OS === 'android' ? 40 : 20,
      paddingBottom: 30,
      paddingHorizontal: 20,
      borderBottomLeftRadius: 24,
      borderBottomRightRadius: 24,
  },
  headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
  },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: C.primarySoft, marginBottom: 2 },
  refreshBtn: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 8, borderRadius: 12 },

  totalCard: {
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 20,
      alignItems: 'center',
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 10,
      elevation: 5,
      marginBottom: -40, 
  },
  totalLabel: { fontSize: 14, color: C.muted, fontWeight: '600' },
  totalValue: { fontSize: 28, fontWeight: 'bold', color: C.primary, marginVertical: 5 },
  periodBadge: { backgroundColor: C.bg, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 5 },
  periodText: { fontSize: 12, color: C.text },
  
  paidBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 10, gap: 5 },
  paidText: { fontSize: 12, fontWeight: 'bold', color: C.green },

  body: { marginTop: 50, paddingHorizontal: 20 },

  sectionHeader: { marginTop: 20, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: C.text },

  periodSelector: { flexDirection: 'row', backgroundColor: '#fff', padding: 4, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  periodBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  periodBtnActive: { backgroundColor: C.primarySoft },
  periodBtnText: { color: C.muted, fontWeight: '600' },
  periodBtnTextActive: { color: C.primary, fontWeight: 'bold' },

  datePickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  dateBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  dateBtnFull: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border },
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

  emptyState: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: C.muted, marginTop: 10 },
});