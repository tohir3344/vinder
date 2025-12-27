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
  Modal,
  Pressable 
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
  primaryDark: "#A51C24",
  primarySoft: "#E3F2FD",
  text: "#1F2937",
  muted: "#6B7280",
  border: "#E5E7EB",
  bg: "#F3F4F6",
  card: "#FFFFFF",
  green: "#10B981",
  red: "#EF4444",
  orange: "#F59E0B",
  yellowBg: "#FFF9C4", 
  yellowText: "#F57F17",
};

/* =================== HELPERS =================== */
const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// 🔥 LOGIC PERIODE BARU RHEZA: SABTU s/d JUMAT 🔥
// Perbaikan: Kalo hari ini Sabtu, tetap dianggap minggu lalu (biar gajian).
// Reset baru kejadian pas Minggu (0).
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const dow = x.getDay(); // 0=Minggu, 6=Sabtu
  
  // Logic Lama: (dow+1)%7. Kalo Sabtu (6) jadinya 0 -> Reset.
  // Logic Baru: Kalo Sabtu (6), paksa jadi 7 -> Mundur seminggu.
  
  let diff = (dow + 1) % 7; 
  
  if (dow === 6) {
      diff = 7; // Mundur 7 hari penuh biar masih masuk periode minggu lalu
  }
  
  x.setDate(x.getDate() - diff);
  x.setHours(0,0,0,0);
  return x;
};

const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6); // Sabtu + 6 hari = Jumat
  return e;
};

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

const monthLabelID = (d: Date) =>
  d.toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  });

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
  
  gaji_pokok_rp: number;
  gaji_pokok_rate?: number;

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

  const isSaturday = now.getDay() === 6;

  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const [loading, setLoading] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [showInfo, setShowInfo] = useState(false);

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

    // 🔥 LOGIC PENENTU: EXCLUDE HARI INI (LEMBUR HARI INI BELUM CAIR) 🔥
    // Kita paksa request API hanya sampai KEMARIN.
    const dYesterday = new Date();
    dYesterday.setDate(dYesterday.getDate() - 1);
    const yesterdayStr = iso(dYesterday);

    // Jika periode akhir (Jumat) masih di masa depan atau hari ini,
    // kita potong tanggalnya jadi Kemarin.
    let apiEndStr = endStr;
    if (yesterdayStr < endStr) {
        apiEndStr = yesterdayStr;
    }

    // Jika Hari Ini Sabtu (Start Periode), dan Kemarin (Jumat) udah periode lalu
    // Maka apiEndStr < startStr, yang artinya belum ada data valid di minggu ini (H+0).
    // TAPI: Dengan logic baru startOfWeek, startStr bakal mundur ke Sabtu lalu.
    // Jadi kondisi ini harusnya aman buat hari Sabtu (tetap load data).
    if (apiEndStr < startStr) {
        setSlip({
            user_id: myId,
            nama: myName,
            periode_start: startStr,
            periode_end: endStr,
            hadir_minggu: 0,
            lembur_menit: 0,
            lembur_rp: 0, // LEMBUR HARI INI MASIH 0
            gaji_pokok_rp: 0,
            angsuran_rp: 0,
            thr_rp: 0,
            bonus_akhir_tahun_rp: 0,
            others_total_rp: 0,
            total_gaji_rp: 0,
            is_preview: true,
            status_bayar: 'unpaid'
        });
        setLoading(false);
        return;
    }

    try {
      setLoading(true);

      // 🔥 REQUEST LIVE DATA: PAKE apiEndStr (Sampai Kemarin) 🔥
      // Ini menjamin Lembur Hari Ini TIDAK KEBACA
      const urlPrev = `${API_PREVIEW}?user_id=${myId}&start=${startStr}&end=${apiEndStr}`;
      const rPrev = await fetch(urlPrev);
      const jPrev = await rPrev.json();
      const liveData = jPrev?.success ? jPrev.data : {};

      const urlSlip = `${API_SLIP}?user_id=${myId}&start=${startStr}&end=${endStr}&mode=${mode}`;
      const rSlip = await fetch(urlSlip);
      const jSlip = await rSlip.json();
      const savedData = (jSlip?.success && jSlip?.data?.[0]) ? jSlip.data[0] : null;

      let validSavedData = null;
      if (savedData) {
          const apiStart = String(savedData.periode_start || "").split(' ')[0];
          if (apiStart === startStr) {
              validSavedData = savedData;
          }
      }

      if (validSavedData) {
        if (validSavedData.status_bayar === 'paid') {
           setSlip(validSavedData);
           return;
        }

        const savedHadir = Number(validSavedData.hadir_minggu || 0);
        const savedGP = Number(validSavedData.gaji_pokok_rp || 0);
        const ratePerHari = savedHadir > 0 ? (savedGP / savedHadir) : 0;

        const currentHadir = Number(liveData.hadir_minggu || 0); 
        const currentLemburRp = Number(liveData.lembur_rp || 0); // INI JUGA UDAH DI-FILTER KEMARIN
        const currentLemburMnt = Number(liveData.lembur_menit || 0);

        let realTimeGajiPokok = 0;
        if (ratePerHari > 0) {
            realTimeGajiPokok = ratePerHari * currentHadir;
        } else {
            const masterRate = Number(liveData.gaji_pokok_rp || 0) / (Number(liveData.hadir_minggu)||1);
            realTimeGajiPokok = masterRate * currentHadir;
        }

        const thr = Number(validSavedData.thr_rp || 0);
        const bonus = Number(validSavedData.bonus_akhir_tahun_rp || 0);
        const others = Number(validSavedData.others_total_rp || 0);
        const angsuran = Number(validSavedData.angsuran_rp || 0); 

        const totalBaru = realTimeGajiPokok + currentLemburRp + thr + bonus + others - angsuran;

        setSlip({
            ...validSavedData,
            hadir_minggu: currentHadir,
            lembur_menit: currentLemburMnt,
            lembur_rp: currentLemburRp,
            gaji_pokok_rp: realTimeGajiPokok,
            gaji_pokok_rate: ratePerHari || (realTimeGajiPokok/currentHadir),
            total_gaji_rp: totalBaru, 
            is_preview: true 
        } as Slip);

      } else {
        const rateGaji = Number(liveData.gaji_pokok_rp ?? 0); 
        const hadir = Number(liveData.hadir_minggu ?? 0);
        const estimasiGajiPokok = rateGaji * hadir;
        
        const sisaUtang = Number(liveData.angsuran_rp ?? 0);
        let estimasiPotongan = 0;
        if (sisaUtang >= 300000) estimasiPotongan = 300000;
        else if (sisaUtang > 0) estimasiPotongan = sisaUtang;

        const lemburRp = Number(liveData.lembur_rp ?? 0); // LEMBUR HANYA SAMPAI KEMARIN
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
          others_json: [],
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

  useEffect(() => {
     fetchSlip();
  }, [myId, start, end, mode]);

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
              <View style={{flexDirection:'row', gap: 10}}>
                  <TouchableOpacity style={st.infoBtn} onPress={() => setShowInfo(true)}>
                      <Ionicons name="information-circle-outline" size={24} color="#FFF" />
                  </TouchableOpacity>
                  <TouchableOpacity style={st.refreshBtn} onPress={onRefresh}>
                      <Ionicons name="refresh" size={20} color="#fff" />
                  </TouchableOpacity>
              </View>
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
          {/* 🔥 BANNER KHUSUS HARI SABTU 🔥 */}
          {isSaturday && mode === 'week' && (
             <View style={st.infoBanner}>
                <Ionicons name="information-circle" size={22} color={C.yellowText} />
                <Text style={st.infoBannerText}>
                   Hari ini <Text style={{fontWeight:'bold'}}>Sabtu (Gajian)</Text>. Data yang tampil adalah periode minggu lalu.{"\n"}
                   Gaji untuk minggu baru (hari ini) akan mulai dihitung besok (Minggu).
                </Text>
             </View>
          )}

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
                          {monthLabelID(monthAnchor)}
                      </Text>
                  </TouchableOpacity>
              )}
          </View>

          {showStart && <DateTimePicker value={start} mode="date" onChange={(e, d) => { setShowStart(false); if(d) { setStart(startOfWeek(d)); setEnd(endOfWeek(d)); }}} />}
          {showEnd && <DateTimePicker value={end} mode="date" onChange={(e, d) => { setShowEnd(false); if(d) { setStart(startOfWeek(d)); setEnd(endOfWeek(d)); }}} />}
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

      {/* Modal INFO FITUR */}
      <Modal transparent visible={showInfo} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={st.modalOverlay}>
          <View style={[st.modalBox, {maxHeight: '70%'}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                <Text style={st.modalTitle}>Sistem Penggajian</Text>
                <Pressable onPress={() => setShowInfo(false)}>
                    <Ionicons name="close" size={24} color="#666" />
                </Pressable>
            </View>
            <ScrollView style={{marginBottom: 10}}>
                <Text style={st.infoItem}>📅 <Text style={{fontWeight:'bold'}}>Periode:</Text> Hitungan gaji mingguan dimulai dari hari Sabtu s/d Jumat.</Text>
                <Text style={st.infoItem}>💰 <Text style={{fontWeight:'bold'}}>Gajian:</Text> Pembayaran dilakukan setiap hari Sabtu.</Text>
                <Text style={st.infoItem}>🔄 <Text style={{fontWeight:'bold'}}>Reset:</Text> Saldo gaji otomatis di-reset setiap hari Minggu jam 00:00.</Text>
                <Text style={st.infoItem}>⚠️ <Text style={{fontWeight:'bold'}}>Hari Ini:</Text> Kehadiran & Lembur hari ini baru akan masuk ke saldo gaji besok (H+1).</Text>
            </ScrollView>
            
            <Pressable 
                onPress={() => setShowInfo(false)} 
                style={st.modalBtnFull}
            >
              <Text style={{color:'#fff', fontWeight:'bold'}}>Mengerti</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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
  infoBtn: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 8, borderRadius: 12 },

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

  // BANNER STYLE
  infoBanner: {
      backgroundColor: C.yellowBg,
      padding: 12,
      borderRadius: 10,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: '#FFF176'
  },
  infoBannerText: { color: C.yellowText, fontSize: 12, flex: 1, lineHeight: 18 },

  sectionHeader: { marginTop: 0, marginBottom: 10 },
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

  // MODAL STYLES
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalBox: { backgroundColor: "#fff", borderRadius: 12, width: "100%", maxWidth: 400, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  modalTitle: { fontWeight: "800", fontSize: 18, marginBottom: 8, color: "#111827" },
  modalBtnFull: { 
    backgroundColor: '#A51C24', 
      width: '100%', 
      alignItems: 'center', 
      paddingVertical: 12, 
      borderRadius: 8 
  },
  infoItem: { marginBottom: 10, color: "#374151", lineHeight: 20, fontSize: 14 },
});